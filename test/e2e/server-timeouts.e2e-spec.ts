import { connect, Socket } from 'node:net';
import { AddressInfo } from 'node:net';
import { AppConfig } from '../../src/presentation/http/config';
import { startApp, TestApp } from './support/test-app';

// Short values so the test is quick; the production defaults live in loadConfig.
const SHORT: Record<string, number> = {
  requestTimeoutMs: 2_000,
  headersTimeoutMs: 800,
  keepAliveTimeoutMs: 1_000,
};

function open(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => resolve(socket));
    socket.once('error', reject);
  });
}

/** Resolves with the elapsed ms when the server closes the socket, or null after `limitMs`. */
function closedWithin(socket: Socket, limitMs: number): Promise<number | null> {
  const started = Date.now();
  socket.on('error', () => undefined);
  socket.resume();
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), limitMs);
    socket.once('close', () => {
      clearTimeout(timer);
      resolve(Date.now() - started);
    });
  });
}

describe('server timeouts', () => {
  let t: TestApp;
  let port: number;

  beforeAll(async () => {
    t = await startApp(SHORT as Partial<AppConfig>);
    await t.app.listen(0);
    port = (t.app.getHttpServer().address() as AddressInfo).port;
  });
  afterAll(async () => {
    await t.close();
  });

  it('closes a socket that sends part of the headers and then stalls', async () => {
    const socket = await open(port);
    socket.write(`POST /receipts HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Le`);
    const elapsed = await closedWithin(socket, 6_000);
    socket.destroy();
    expect(elapsed).not.toBeNull();
    expect(elapsed as number).toBeLessThan(5_000);
  }, 15_000);

  it('closes a socket that sends the headers and then never sends the body', async () => {
    const socket = await open(port);
    socket.write(
      `POST /auth/login HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
        'Content-Type: application/json\r\nContent-Length: 1000\r\n\r\n{"a":',
    );
    const elapsed = await closedWithin(socket, 8_000);
    socket.destroy();
    expect(elapsed).not.toBeNull();
    expect(elapsed as number).toBeLessThan(7_000);
  }, 15_000);

  it('applies the configured values to the Node server', () => {
    const server = t.app.getHttpServer() as {
      requestTimeout: number;
      headersTimeout: number;
      keepAliveTimeout: number;
    };
    expect(server.requestTimeout).toBe(2_000);
    expect(server.headersTimeout).toBe(800);
    expect(server.keepAliveTimeout).toBe(1_000);
  });
});
