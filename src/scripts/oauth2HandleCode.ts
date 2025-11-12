import 'dotenv/config';
import { TwitterClient } from '../twitter/client';
import { logger } from '../utils/logger';
import { setEnvVar } from '../utils/envWriter';

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    logger.error('Usage: ts-node src/scripts/oauth2HandleCode.ts [--force] <full_redirect_url | code state>');
    process.exit(1);
  }
  let force = false;
  const cleaned: string[] = [];
  for (const a of args) {
    if (a === '--force') force = true; else cleaned.push(a);
  }
  if (cleaned.length === 1 && cleaned[0].startsWith('http')) {
    try {
      const url = new URL(cleaned[0]);
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code || !state) throw new Error('Missing code/state in URL');
      return { code, state, force };
    } catch (e) {
      logger.error(`Failed to parse URL: ${e}`);
      process.exit(1);
    }
  }
  if (cleaned.length >= 2) {
    const [code, state] = cleaned;
    return { code, state, force };
  }
  logger.error('Invalid arguments');
  process.exit(1);
}

async function main() {
  const { code, state, force } = parseArgs();
  try {
    const tokens = await TwitterClient.handleOAuth2Callback(code, state, { force });
    setEnvVar('TWITTER_OAUTH2_ACCESS_TOKEN', tokens.accessToken);
    if (tokens.refreshToken) {
      setEnvVar('TWITTER_OAUTH2_REFRESH_TOKEN', tokens.refreshToken);
    }
    logger.info('OAuth2 tokens stored. You can now run the bot.');
  } catch (e: any) {
    logger.error(`Failed to handle OAuth2 code/state: ${e?.message || e}`);
    process.exit(1);
  }
}

main();
