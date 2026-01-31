import { TwitterClient } from '../src/twitter/client';
import { TwitterApi } from 'twitter-api-v2';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('twitter-api-v2');
jest.mock('fs');
jest.mock('../src/utils/envWriter');
jest.mock('../src/utils/logger', () => ({
    logger: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
    },
}));

// Mock config before importing anything that uses it
jest.mock('../src/config', () => ({
    config: {
        TWITTER_CLIENT_ID: 'test_client_id',
        TWITTER_CLIENT_SECRET: 'test_client_secret',
        TWITTER_OAUTH2_CLIENT_ID: 'test_client_id',
        OAUTH2_REFRESH_MAX_RETRIES: 3,
        OAUTH2_REFRESH_BACKOFF_MS: 1000,
    },
}));

describe('OAuth2 Token Refresh Integration Tests', () => {
    let mockTwitterApi: jest.Mocked<any>;
    let mockClient: jest.Mocked<any>;
    const OAUTH2_TOKEN_FILE = path.join(process.cwd(), '.twitter-oauth2-tokens.json');
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        jest.clearAllMocks();
        
        // Save and clear OAuth1 credentials to prevent fallback
        originalEnv = process.env;
        process.env = { ...originalEnv };
        delete process.env.TWITTER_API_KEY;
        delete process.env.TWITTER_API_SECRET;
        delete process.env.TWITTER_ACCESS_TOKEN;
        delete process.env.TWITTER_ACCESS_SECRET;
        
        // Set OAuth2 credentials
        process.env.TWITTER_OAUTH2_CLIENT_ID = 'test_client_id';
        process.env.TWITTER_CLIENT_ID = 'test_client_id';
        
        // Mock the TwitterApi instance methods
        mockClient = {
            v2: {
                userByUsername: jest.fn().mockResolvedValue({ data: { id: '123' } }),
                userTimeline: jest.fn().mockResolvedValue({ data: { data: [] } }),
                tweet: jest.fn().mockResolvedValue({ data: { id: '456' } }),
            },
        };
        
        mockTwitterApi = {
            refreshOAuth2Token: jest.fn(),
            v2: mockClient.v2,
        };
        
        (TwitterApi as jest.MockedClass<typeof TwitterApi>).mockImplementation((credentials: any) => {
            // Always return an object with refreshOAuth2Token method and v2 API
            return mockTwitterApi as any;
        });
        
        // Mock fs operations
        (fs.existsSync as jest.Mock).mockReturnValue(false);
        (fs.readFileSync as jest.Mock).mockReturnValue('{}');
        (fs.writeFileSync as jest.Mock).mockImplementation(() => {});
        (fs.renameSync as jest.Mock).mockImplementation(() => {});
        (fs.unlinkSync as jest.Mock).mockImplementation(() => {});
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('Token Refresh Success Scenarios', () => {
        it('should successfully refresh OAuth2 token when expired', async () => {
            const mockStoredTokens = {
                accessToken: 'old_access_token',
                refreshToken: 'old_refresh_token',
                expiresAt: Date.now() - 1000, // expired
                scope: ['tweet.read', 'tweet.write'],
            };

            const mockRefreshedTokens = {
                accessToken: 'new_access_token',
                refreshToken: 'new_refresh_token',
                expiresIn: 7200,
                scope: ['tweet.read', 'tweet.write', 'offline.access'],
            };

            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockStoredTokens));
            mockTwitterApi.refreshOAuth2Token.mockResolvedValueOnce(mockRefreshedTokens);

            const client = new TwitterClient();
            await client.getUserByUsername('testuser');

            expect(mockTwitterApi.refreshOAuth2Token).toHaveBeenCalledWith('old_refresh_token');
            expect(fs.writeFileSync).toHaveBeenCalled();
        });

        it('should handle token rotation correctly', async () => {
            const mockStoredTokens = {
                accessToken: 'old_access_token',
                refreshToken: 'old_refresh_token',
                expiresAt: Date.now() - 1000,
                scope: ['tweet.read', 'tweet.write'],
            };

            const mockRefreshedTokens = {
                accessToken: 'new_access_token',
                refreshToken: 'rotated_refresh_token',
                expiresIn: 7200,
                scope: ['tweet.read', 'tweet.write', 'offline.access'],
            };

            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockStoredTokens));
            mockTwitterApi.refreshOAuth2Token.mockResolvedValueOnce(mockRefreshedTokens);

            const { setEnvVar } = require('../src/utils/envWriter');
            
            const client = new TwitterClient();
            await client.getUserByUsername('testuser');

            expect(setEnvVar).toHaveBeenCalledWith('TWITTER_OAUTH2_REFRESH_TOKEN', 'rotated_refresh_token');
        });

        it('should preserve existing token when not expired', async () => {
            const mockStoredTokens = {
                accessToken: 'valid_access_token',
                refreshToken: 'valid_refresh_token',
                expiresAt: Date.now() + 3600000, // expires in 1 hour
                scope: ['tweet.read', 'tweet.write'],
            };

            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockStoredTokens));

            const client = new TwitterClient();
            await client.getUserByUsername('testuser');

            expect(mockTwitterApi.refreshOAuth2Token).not.toHaveBeenCalled();
        });
    });

    describe('Retry Logic', () => {
        it('should retry on 500 errors with exponential backoff', async () => {
            const mockStoredTokens = {
                accessToken: 'old_access_token',
                refreshToken: 'old_refresh_token',
                expiresAt: Date.now() - 1000,
                scope: ['tweet.read', 'tweet.write'],
            };

            const mockRefreshedTokens = {
                accessToken: 'new_access_token',
                refreshToken: 'new_refresh_token',
                expiresIn: 7200,
                scope: ['tweet.read', 'tweet.write', 'offline.access'],
            };

            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockStoredTokens));

            mockTwitterApi.refreshOAuth2Token
                .mockRejectedValueOnce({ code: 500, message: 'Internal Server Error' })
                .mockRejectedValueOnce({ code: 500, message: 'Internal Server Error' })
                .mockResolvedValueOnce(mockRefreshedTokens);

            const client = new TwitterClient();
            await client.getUserByUsername('testuser');

            expect(mockTwitterApi.refreshOAuth2Token).toHaveBeenCalledTimes(3);
        }, 10000);

        it('should not retry on 400 errors', async () => {
            const mockStoredTokens = {
                accessToken: 'old_access_token',
                refreshToken: 'invalid_refresh_token',
                expiresAt: Date.now() - 1000,
                scope: ['tweet.read', 'tweet.write'],
            };

            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockStoredTokens));
            mockTwitterApi.refreshOAuth2Token.mockRejectedValueOnce({ code: 400, message: 'Invalid refresh token' });

            const { logger } = require('../src/utils/logger');
            
            const client = new TwitterClient();
            await client.getUserByUsername('testuser');

            expect(mockTwitterApi.refreshOAuth2Token).toHaveBeenCalledTimes(1);
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('400'));
        });

        it('should not retry on 401 errors', async () => {
            const mockStoredTokens = {
                accessToken: 'old_access_token',
                refreshToken: 'expired_refresh_token',
                expiresAt: Date.now() - 1000,
                scope: ['tweet.read', 'tweet.write'],
            };

            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockStoredTokens));
            mockTwitterApi.refreshOAuth2Token.mockRejectedValueOnce({ code: 401, message: 'Unauthorized' });

            const { logger } = require('../src/utils/logger');
            
            const client = new TwitterClient();
            await client.getUserByUsername('testuser');

            expect(mockTwitterApi.refreshOAuth2Token).toHaveBeenCalledTimes(1);
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to refresh OAuth2 token'));
        });
    });

    describe('Expiration Handling', () => {
        it('should detect and refresh expired tokens', async () => {
            const mockStoredTokens = {
                accessToken: 'expired_access_token',
                refreshToken: 'valid_refresh_token',
                expiresAt: Date.now() - 86400000, // expired 1 day ago
                scope: ['tweet.read', 'tweet.write'],
            };

            const mockRefreshedTokens = {
                accessToken: 'fresh_access_token',
                refreshToken: 'fresh_refresh_token',
                expiresIn: 7200,
                scope: ['tweet.read', 'tweet.write', 'offline.access'],
            };

            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockStoredTokens));
            mockTwitterApi.refreshOAuth2Token.mockResolvedValueOnce(mockRefreshedTokens);

            const client = new TwitterClient();
            await client.getUserByUsername('testuser');

            expect(mockTwitterApi.refreshOAuth2Token).toHaveBeenCalled();
        });

        it('should calculate expiration time correctly from expiresIn', async () => {
            const mockStoredTokens = {
                accessToken: 'old_access_token',
                refreshToken: 'old_refresh_token',
                expiresAt: Date.now() - 1000,
                scope: ['tweet.read', 'tweet.write'],
            };

            const mockRefreshedTokens = {
                accessToken: 'new_access_token',
                refreshToken: 'new_refresh_token',
                expiresIn: 7200, // 2 hours
                scope: ['tweet.read', 'tweet.write'],
            };

            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockStoredTokens));
            mockTwitterApi.refreshOAuth2Token.mockResolvedValueOnce(mockRefreshedTokens);

            const beforeTime = Date.now();
            const client = new TwitterClient();
            await client.getUserByUsername('testuser');
            const afterTime = Date.now();

            const writeCall = (fs.writeFileSync as jest.Mock).mock.calls.find(call =>
                call[0].includes('.twitter-oauth2-tokens.json')
            );
            expect(writeCall).toBeDefined();
            
            const writtenData = JSON.parse(writeCall![1]);
            // The implementation subtracts 5s safety margin: Date.now() + (expiresIn * 1000) - 5000
            const expectedExpiresAt = beforeTime + 7200 * 1000 - 5000;
            
            expect(writtenData.expiresAt).toBeGreaterThanOrEqual(expectedExpiresAt);
            expect(writtenData.expiresAt).toBeLessThanOrEqual(afterTime + 7200 * 1000 - 5000);
        });
    });

    describe('OAuth1 Fallback', () => {
        it('should fallback to OAuth1 on 400 error if configured', async () => {
            const mockStoredTokens = {
                accessToken: 'old_access_token',
                refreshToken: 'invalid_refresh_token',
                expiresAt: Date.now() - 1000,
                scope: ['tweet.read', 'tweet.write'],
            };

            process.env.TWITTER_API_KEY = 'api_key';
            process.env.TWITTER_API_SECRET = 'api_secret';
            process.env.TWITTER_ACCESS_TOKEN = 'access_token';
            process.env.TWITTER_ACCESS_SECRET = 'access_secret';

            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockStoredTokens));
            mockTwitterApi.refreshOAuth2Token.mockRejectedValueOnce({ code: 400, message: 'Invalid refresh token' });

            const client = new TwitterClient();
            await client.getUserByUsername('testuser');

            // Should have attempted OAuth2 refresh, then fallen back to OAuth1
            expect(mockTwitterApi.refreshOAuth2Token).toHaveBeenCalledTimes(1);
        });
    });

    describe('Token Persistence', () => {
        it('should atomically write token file', async () => {
            const mockStoredTokens = {
                accessToken: 'old_access_token',
                refreshToken: 'old_refresh_token',
                expiresAt: Date.now() - 1000,
                scope: ['tweet.read', 'tweet.write'],
            };

            const mockRefreshedTokens = {
                accessToken: 'new_access_token',
                refreshToken: 'new_refresh_token',
                expiresIn: 7200,
                scope: ['tweet.read', 'tweet.write'],
            };

            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockStoredTokens));
            mockTwitterApi.refreshOAuth2Token.mockResolvedValueOnce(mockRefreshedTokens);

            const client = new TwitterClient();
            await client.getUserByUsername('testuser');

            const writeCall = (fs.writeFileSync as jest.Mock).mock.calls.find(call =>
                call[0].includes('.tmp')
            );
            expect(writeCall).toBeDefined();
            expect(fs.renameSync).toHaveBeenCalled();
        });

        it('should handle write errors gracefully', async () => {
            const mockStoredTokens = {
                accessToken: 'old_access_token',
                refreshToken: 'old_refresh_token',
                expiresAt: Date.now() - 1000,
                scope: ['tweet.read', 'tweet.write'],
            };

            const mockRefreshedTokens = {
                accessToken: 'new_access_token',
                refreshToken: 'new_refresh_token',
                expiresIn: 7200,
                scope: ['tweet.read', 'tweet.write'],
            };

            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockStoredTokens));
            mockTwitterApi.refreshOAuth2Token.mockResolvedValueOnce(mockRefreshedTokens);
            (fs.writeFileSync as jest.Mock).mockImplementationOnce(() => {
                throw new Error('Write error');
            });

            const { logger } = require('../src/utils/logger');
            
            const client = new TwitterClient();
            await client.getUserByUsername('testuser');

            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to persist OAuth2 tokens'));
        });
    });

    describe('Edge Cases', () => {
        it('should handle missing refresh token gracefully', async () => {
            const mockStoredTokens = {
                accessToken: 'old_access_token',
                // No refreshToken
                expiresAt: Date.now() - 1000,
                scope: ['tweet.read', 'tweet.write'],
            };

            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockStoredTokens));

            const client = new TwitterClient();
            await client.getUserByUsername('testuser');

            // Should not attempt to refresh without a refresh token
            expect(mockTwitterApi.refreshOAuth2Token).not.toHaveBeenCalled();
        });

        it('should handle missing CLIENT_ID gracefully', async () => {
            const mockStoredTokens = {
                accessToken: 'old_access_token',
                refreshToken: 'old_refresh_token',
                expiresAt: Date.now() - 1000,
                scope: ['tweet.read', 'tweet.write'],
            };

            // Temporarily mock config with missing CLIENT_ID
            const configModule = require('../src/config');
            const originalClientId = configModule.config.TWITTER_CLIENT_ID;
            configModule.config.TWITTER_CLIENT_ID = '';

            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockStoredTokens));

            const { logger } = require('../src/utils/logger');
            
            const client = new TwitterClient();
            await client.getUserByUsername('testuser');

            // Should log error about missing CLIENT_ID
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('CLIENT_ID'));
            
            // Restore original value
            configModule.config.TWITTER_CLIENT_ID = originalClientId;
        });

        it('should handle malformed token file', async () => {
            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readFileSync as jest.Mock).mockReturnValue('invalid json');

            expect(() => new TwitterClient()).toThrow();
        });
    });
});
