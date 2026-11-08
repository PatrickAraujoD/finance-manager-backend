import { Logger } from '@nestjs/common';
import { connect, Socket } from 'node:net';
import { AddressInfo } from 'node:net';
import request from 'supertest';
import { bearer, Session, signUp } from './support/auth-helpers';
import { cleanTables, startApp, TestApp } from './support/test-app';

const BOUNDARY = '----abortboundary';

function openSocket(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => resolve(socket));
    socket.once('error', reject);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('client aborting an upload', () => {
  let t: TestApp;
  let ana: Session;
  let port: number;

  beforeAll(async () => {
    t = await startApp();
    await t.app.listen(0);
    port = (t.app.getHttpServer().address() as AddressInfo).port;
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await cleanTables(t.prisma);
    ana = await signUp(t, 'ana@example.com');
  });
  afterEach(() => jest.restoreAllMocks());

  it('is a short warning, never an ERROR with a stack, and the server stays healthy', async () => {
    const errors: unknown[][] = [];
    const warnings: unknown[][] = [];
    jest.spyOn(Logger.prototype, 'error').mockImplementation((...a: unknown[]) => {
      errors.push(a);
    });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation((...a: unknown[]) => {
      warnings.push(a);
    });

    const socket = await openSocket(port);
    socket.on('error', () => undefined);
    const head = [
      'POST /receipts HTTP/1.1',
      `Host: 127.0.0.1:${port}`,
      `Authorization: ${bearer(ana)[1]}`,
      `Content-Type: multipart/form-data; boundary=${BOUNDARY}`,
      'Content-Length: 200000',
      '',
      '',
    ].join('\r\n');
    const partial =
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="paidAlone"\r\n\r\ntrue\r\n` +
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\n` +
      `Content-Type: application/pdf\r\n\r\n%PDF-1.4 partial`;
    socket.write(head + partial);
    await sleep(300);
    socket.destroy();

    for (let i = 0; i < 40 && errors.length + warnings.length === 0; i++) await sleep(50);
    await sleep(200);

    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(1);
    const text = String(warnings[0][0]);
    expect(text).toMatch(/aborted/i);
    expect(text).not.toMatch(/\n\s+at /);
    expect(warnings[0]).toHaveLength(1);

    const health = await request(t.app.getHttpServer()).get('/health');
    expect(health.status).toBe(200);
    const me = await request(t.app.getHttpServer()).get('/auth/me').set(...bearer(ana));
    expect(me.status).toBe(200);
  });
});
