import { Logger } from '@nestjs/common';
import { AddressInfo, connect, Socket } from 'node:net';
import request from 'supertest';
import { AppConfig } from '../../src/presentation/http/config';
import { bearer, Session, signUp } from './support/auth-helpers';
import { cleanTables, startApp, TestApp } from './support/test-app';

function openSocket(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => resolve(socket));
    socket.once('error', reject);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Short values so the stalled-body case is quick.
const SHORT: Partial<AppConfig> = {
  requestTimeoutMs: 2_000,
  headersTimeoutMs: 800,
  keepAliveTimeoutMs: 1_000,
};

describe('client aborting a JSON body', () => {
  let t: TestApp;
  let ana: Session;
  let port: number;
  const errors: unknown[][] = [];
  const warnings: unknown[][] = [];

  beforeAll(async () => {
    t = await startApp(SHORT);
    await t.app.listen(0);
    port = (t.app.getHttpServer().address() as AddressInfo).port;
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await cleanTables(t.prisma);
    ana = await signUp(t, 'ana@example.com');
    errors.length = 0;
    warnings.length = 0;
    jest.spyOn(Logger.prototype, 'error').mockImplementation((...a: unknown[]) => {
      errors.push(a);
    });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation((...a: unknown[]) => {
      warnings.push(a);
    });
  });
  afterEach(() => jest.restoreAllMocks());

  const head = (length: number) =>
    [
      'POST /expenses HTTP/1.1',
      `Host: 127.0.0.1:${port}`,
      `Authorization: ${bearer(ana)[1]}`,
      'Content-Type: application/json',
      `Content-Length: ${length}`,
      '',
      '',
    ].join('\r\n');

  function expectShortWarningOnly() {
    expect(errors).toEqual([]);
    for (const w of warnings) {
      expect(w).toHaveLength(1);
      expect(String(w[0])).not.toMatch(/\n\s+at /);
    }
  }

  it('is a short warning, never an ERROR with a stack, when the client hangs up', async () => {
    const socket = await openSocket(port);
    socket.on('error', () => undefined);
    socket.write(head(500) + '{"a":');
    await sleep(300);
    socket.destroy();

    for (let i = 0; i < 40 && errors.length + warnings.length === 0; i++) await sleep(50);
    await sleep(200);

    expectShortWarningOnly();
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0][0])).toMatch(/aborted/i);

    const health = await request(t.app.getHttpServer()).get('/health');
    expect(health.status).toBe(200);
  });

  it('is not an ERROR when the server closes a stalled body by timeout', async () => {
    const socket = await openSocket(port);
    socket.on('error', () => undefined);
    socket.resume();
    let giveUp: NodeJS.Timeout | undefined;
    const closed = new Promise<void>((resolve) => {
      socket.once('close', () => resolve());
      giveUp = setTimeout(resolve, 8_000);
    });
    socket.write(head(1000) + '{"a":');
    await closed;
    clearTimeout(giveUp);
    socket.destroy();
    await sleep(500);

    expectShortWarningOnly();
    const health = await request(t.app.getHttpServer()).get('/health');
    expect(health.status).toBe(200);
  }, 20_000);
});
