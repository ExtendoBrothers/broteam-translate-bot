jest.mock('../src/utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { AddressInfo } from 'net';
import puppeteer from 'puppeteer-core';
import { WebSocketServer } from 'ws';
import { connectToFirefox } from '../src/server/firefoxConnection';

describe('Firefox connection', () => {
  afterEach(() => jest.restoreAllMocks());

  it('closes failed connection attempts when another automation session is active', async () => {
    // Real puppeteer-core is ESM-only and cannot be loaded by Jest, so simulate its rejection of the busy session.
    jest.spyOn(puppeteer, 'connect').mockRejectedValue(
      new Error('session not created: Maximum number of active sessions'),
    );
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>(resolve => server.once('listening', resolve));
    const closed: Promise<void>[] = [];
    server.on('connection', socket => {
      closed.push(new Promise<void>(resolve => socket.once('close', () => resolve())));
    });

    try {
      const endpoint = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/session`;
      for (let i = 0; i < 2; i++) {
        await expect(connectToFirefox(endpoint)).rejects.toThrow('Firefox already has an active automation session');
      }
      await Promise.all(closed);
      expect(closed).toHaveLength(2);
      expect(server.clients.size).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
