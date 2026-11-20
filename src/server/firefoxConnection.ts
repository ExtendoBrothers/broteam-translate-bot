import puppeteer, { Browser, ConnectionTransport } from 'puppeteer-core';
import WebSocket from 'ws';
import { logger } from '../utils/logger';

export async function connectToFirefox(endpoint: string): Promise<Browser> {
  const socket = new WebSocket(endpoint, { handshakeTimeout: 10_000 });
  const transport: ConnectionTransport = {
    send: message => socket.send(message),
    close: () => socket.close(),
  };
  socket.on('message', data => transport.onmessage?.(data.toString()));
  socket.on('close', () => transport.onclose?.());
  socket.on('error', error => logger.warn(`[BrowserPublisher] Firefox connection error: ${error.message}`));

  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  try {
    return await puppeteer.connect({ transport, protocol: 'webDriverBiDi', defaultViewport: null });
  } catch (error) {
    socket.terminate();
    if (error instanceof Error && error.message.includes('Maximum number of active sessions')) {
      const failure: Error & { cause?: unknown } = new Error(
        'Firefox already has an active automation session. Stop the other client or restart Firefox with remote debugging enabled.',
      );
      failure.cause = error;
      throw failure;
    }
    throw error;
  }
}
