import { Logger } from '@nestjs/common';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { ReceiptExtractor } from '../../src/application/ports/receipt-extractor';
import { ReceiptRepository } from '../../src/application/ports/receipt-repository';
import { FileStorage } from '../../src/application/ports/file-storage';
import { Money } from '../../src/domain/money';
import {
  FILE_STORAGE,
  RECEIPT_EXTRACTOR,
  RECEIPT_REPOSITORY,
} from '../../src/presentation/http/tokens';
import { bearer, Session, signUp } from './support/auth-helpers';
import { cleanTables, startApp, TestApp } from './support/test-app';

const FIXTURES = join(__dirname, '..', 'fixtures');
const fixture = (name: string) => readFile(join(FIXTURES, name));
const MIB = 1024 * 1024;

let uploadDir: string;
const files = () => readdir(uploadDir).catch(() => [] as string[]);

/** Child processes of this very test process (a leaked PDF/OCR child would show up here). */
function myChildren(): string[] {
  const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' });
  return out
    .split('\n')
    .filter((line) => new RegExp(`^\\s*\\d+\\s+${process.pid}\\s`).test(line))
    .filter((line) => !/\bps\b/.test(line));
}

async function expectNoChildren(): Promise<void> {
  for (let i = 0; i < 30 && myChildren().length > 0; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(myChildren()).toEqual([]);
}

interface Upload {
  file?: Buffer;
  filename?: string;
  contentType?: string;
  fieldName?: string;
  paidAlone?: string | null;
  extra?: Record<string, string>;
}

describe('receipts endpoints', () => {
  let t: TestApp;
  let ana: Session;
  let bia: Session;
  let admin: Session;

  beforeAll(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'fm-e2e-uploads-'));
    t = await startApp({ uploadDir });
  });
  afterAll(async () => {
    await t.close();
    await expectNoChildren();
    await rm(uploadDir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await cleanTables(t.prisma);
    for (const f of await files()) await unlink(join(uploadDir, f));
    admin = await signUp(t, 'admin@example.com', 'A');
    ana = await signUp(t, 'ana@example.com');
    bia = await signUp(t, 'bia@example.com');
  });

  const http = () => request(t.app.getHttpServer());

  function post(s: Session | null, u: Upload) {
    let req = http().post('/receipts');
    if (s) req = req.set(...bearer(s));
    if (u.paidAlone !== null) req = req.field('paidAlone', u.paidAlone ?? 'true');
    for (const [k, v] of Object.entries(u.extra ?? {})) req = req.field(k, v);
    if (u.file) {
      req = req.attach(u.fieldName ?? 'file', u.file, {
        filename: u.filename ?? 'comprovante.pdf',
        contentType: u.contentType ?? 'application/pdf',
      });
    }
    return req;
  }
  const download = (s: Session | null, id: string) => {
    const req = http().get(`/receipts/${id}/file`);
    return s ? req.set(...bearer(s)) : req;
  };

  describe('POST /receipts', () => {
    it('suggests the amount of a PDF with text', async () => {
      const res = await post(ana, { file: await fixture('comprovante-texto.pdf') });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        receiptId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        suggestedAmountCents: 12345,
      });
      expect(await files()).toHaveLength(1);
    });

    it('suggests the amount of a PNG through real OCR', async () => {
      const res = await post(ana, {
        file: await fixture('comprovante.png'),
        filename: 'foto.png',
        contentType: 'image/png',
      });
      expect(res.status).toBe(201);
      expect(res.body.suggestedAmountCents).toBe(12345);
    }, 90_000);

    it.each(['sem-texto.pdf', 'lixo.pdf'])('answers null for %s and keeps the file', async (name) => {
      const res = await post(ana, { file: await fixture(name) });
      expect(res.status).toBe(201);
      expect(res.body.suggestedAmountCents).toBeNull();
      expect(await files()).toHaveLength(1);
    });

    it('stores the receipt for the caller only', async () => {
      const res = await post(ana, { file: await fixture('comprovante-texto.pdf'), paidAlone: 'false' });
      const row = await t.prisma.client.receipt.findUniqueOrThrow({
        where: { id: res.body.receiptId },
      });
      expect(row.userId).toBe(ana.id);
      expect(row.mimeType).toBe('application/pdf');
    });

    it.each([
      ['falso.pdf (a PNG declared as PDF)', 'falso.pdf', 'application/pdf'],
      ['a PDF declared as PNG', 'comprovante-texto.pdf', 'image/png'],
    ])('rejects %s with 400 and stores nothing', async (_n, name, contentType) => {
      const res = await post(ana, { file: await fixture(name), contentType });
      expect(res.status).toBe(400);
      expect(await files()).toEqual([]);
      expect(await t.prisma.client.receipt.count()).toBe(0);
    });

    it.each([
      ['GIF', Buffer.from('GIF89a' + 'x'.repeat(50)), 'image/gif'],
      ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/svg+xml'],
      ['HTML', Buffer.from('<html><script>alert(1)</script></html>'), 'text/html'],
      ['HTML declared as PDF', Buffer.from('<html><script>alert(1)</script></html>'), 'application/pdf'],
    ])('rejects %s with 400', async (_n, file, contentType) => {
      const res = await post(ana, { file, contentType });
      expect(res.status).toBe(400);
      expect(await files()).toEqual([]);
    });

    it('rejects an empty file with 400', async () => {
      const res = await post(ana, { file: Buffer.alloc(0) });
      expect(res.status).toBe(400);
      expect(await files()).toEqual([]);
    });

    it('rejects a file above 5 MiB with a generic 413', async () => {
      const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5 * MIB, 0x41)]);
      const res = await post(ana, { file: big, paidAlone: 'false' });
      expect(res.status).toBe(413);
      expect(res.body).toEqual({ statusCode: 413, error: 'Payload Too Large', message: 'Payload Too Large' });
      expect(await files()).toEqual([]);
    });

    it('rejects a request without a token (401) before touching the body', async () => {
      const res = await post(null, { file: await fixture('comprovante-texto.pdf') });
      expect(res.status).toBe(401);
      expect(await files()).toEqual([]);
    });

    it.each([null, 'yes', '1', 'TRUE', 'True', '', ' true'])(
      'rejects paidAlone=%p with 400',
      async (paidAlone) => {
        const res = await post(ana, { file: await fixture('comprovante-texto.pdf'), paidAlone });
        expect(res.status).toBe(400);
        expect(await files()).toEqual([]);
      },
    );

    it('rejects an unexpected text field with 400', async () => {
      const res = await post(ana, {
        file: await fixture('comprovante-texto.pdf'),
        extra: { userId: ana.id },
      });
      expect(res.status).toBe(400);
      expect(await files()).toEqual([]);
    });

    it('rejects a repeated paidAlone field with 400', async () => {
      const res = await post(ana, {
        file: await fixture('comprovante-texto.pdf'),
        paidAlone: 'true',
      }).field('paidAlone', 'false');
      expect(res.status).toBe(400);
    });

    it('rejects a request without a file with 400', async () => {
      const res = await post(ana, {});
      expect(res.status).toBe(400);
    });

    it('rejects two files with 400', async () => {
      const res = await post(ana, { file: await fixture('comprovante-texto.pdf') }).attach(
        'file',
        await fixture('sem-texto.pdf'),
        { filename: 'b.pdf', contentType: 'application/pdf' },
      );
      expect(res.status).toBe(400);
      expect(await files()).toEqual([]);
    });

    it('rejects a file under the wrong field name with 400', async () => {
      const res = await post(ana, {
        file: await fixture('comprovante-texto.pdf'),
        fieldName: 'upload',
      });
      expect(res.status).toBe(400);
      expect(await files()).toEqual([]);
    });

    it('rejects JSON and other content types without a 500', async () => {
      const json = await http()
        .post('/receipts')
        .set(...bearer(ana))
        .send({ paidAlone: 'true' });
      expect([400, 415]).toContain(json.status);
      const text = await http()
        .post('/receipts')
        .set(...bearer(ana))
        .set('Content-Type', 'text/plain')
        .send('hello');
      expect([400, 415]).toContain(text.status);
    });

    it('rejects an absurdly long paidAlone value with 400', async () => {
      const res = await post(ana, {
        file: await fixture('comprovante-texto.pdf'),
        paidAlone: 'x'.repeat(10_000),
      });
      expect(res.status).toBe(400);
    });

    it('never uses the client file name for anything', async () => {
      const content = await fixture('comprovante-texto.pdf');
      const logs: string[] = [];
      const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((m) =>
        jest.spyOn(Logger.prototype, m).mockImplementation((...a: unknown[]) => {
          logs.push(a.map(String).join(' '));
        }),
      );
      try {
        const names = ['../../x.pdf', 'a"b.pdf', 'line\r\nbreak.pdf', '..\\..\\win.pdf'];
        const ids: string[] = [];
        for (const filename of names) {
          const res = await post(ana, { file: content, filename, paidAlone: 'false' });
          expect([201, 400]).toContain(res.status);
          expect(res.text).not.toMatch(/x\.pdf|a"b|break|win\.pdf/);
          expect(JSON.stringify(res.headers)).not.toMatch(/x\.pdf|a"b|break|win\.pdf/);
          if (res.status === 201) ids.push(res.body.receiptId as string);
        }
        expect(ids.length).toBeGreaterThan(0);
        for (const f of await files()) expect(f).toMatch(/^[0-9a-f-]{36}\.pdf$/);
        // Nothing escaped the upload directory.
        expect(await readdir(join(uploadDir, '..')).then((l) => l.filter((n) => /x\.pdf|win/.test(n)))).toEqual([]);
        const dl = await download(ana, ids[0]);
        expect(dl.headers['content-disposition']).toBe('attachment; filename="comprovante.pdf"');
        expect(logs.join('\n')).not.toMatch(/x\.pdf|a"b|break|win\.pdf/);
      } finally {
        spies.forEach((s) => s.mockRestore());
      }
    });
  });

  describe('GET /receipts/:id/file', () => {
    async function uploadAs(s: Session, name = 'comprovante-texto.pdf') {
      const res = await post(s, { file: await fixture(name), paidAlone: 'false' });
      return res.body.receiptId as string;
    }

    it('gives the owner the exact bytes with fixed, safe headers', async () => {
      const id = await uploadAs(ana);
      const res = await download(ana, id).buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(res.status).toBe(200);
      expect((res.body as Buffer).equals(await fixture('comprovante-texto.pdf'))).toBe(true);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-disposition']).toBe('attachment; filename="comprovante.pdf"');
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    it('takes the Content-Type from the database, never from the bytes', async () => {
      const id = await uploadAs(ana);
      await t.prisma.client.receipt.update({ where: { id }, data: { mimeType: 'image/png' } });
      const res = await download(ana, id);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['content-disposition']).toBe('attachment; filename="comprovante.png"');
    });

    it('answers an identical 404 for another user, an admin and an unknown id', async () => {
      const id = await uploadAs(ana);
      const other = await download(bia, id);
      const asAdmin = await download(admin, id);
      const unknown = await download(bia, '6f1f7f2e-4f27-4d3c-9d0a-0d9a8d6a1111');
      for (const res of [other, asAdmin, unknown]) expect(res.status).toBe(404);
      expect(other.body).toEqual(unknown.body);
      expect(asAdmin.body).toEqual(unknown.body);
      expect(other.text).toBe(unknown.text);
    });

    it('answers 401 without a token, even for a malformed id, and 400 for it afterwards', async () => {
      expect((await download(null, 'not-a-uuid')).status).toBe(401);
      expect((await download(null, '6f1f7f2e-4f27-4d3c-9d0a-0d9a8d6a1111')).status).toBe(401);
      expect((await download(ana, 'not-a-uuid')).status).toBe(400);
    });

    it('answers a generic 404 when the file vanished from disk', async () => {
      const id = await uploadAs(ana);
      for (const f of await files()) await unlink(join(uploadDir, f));
      const res = await download(ana, id);
      expect(res.status).toBe(404);
      expect(res.text).not.toContain(uploadDir);
      expect(res.body).toEqual({ statusCode: 404, error: 'Not Found', message: 'Not Found' });
    });
  });
});

describe('receipts with swapped providers', () => {
  let uploadDirLocal: string;
  let session: Session;

  beforeAll(async () => {
    uploadDirLocal = await mkdtemp(join(tmpdir(), 'fm-e2e-uploads-'));
  });
  afterAll(async () => {
    await expectNoChildren();
    await rm(uploadDirLocal, { recursive: true, force: true });
  });

  async function withApp(
    use: (t: TestApp) => Promise<void>,
    providers: Record<symbol, unknown>,
  ): Promise<void> {
    const t = await startApp({ uploadDir: uploadDirLocal }, [], (b) => {
      for (const sym of Object.getOwnPropertySymbols(providers)) {
        b.overrideProvider(sym).useValue(providers[sym]);
      }
      return b;
    });
    try {
      await cleanTables(t.prisma);
      session = await signUp(t, 'ana@example.com');
      await use(t);
    } finally {
      await t.close();
    }
  }
  const pdfBytes = () => readFile(join(FIXTURES, 'comprovante-texto.pdf'));

  it('never calls the extractor when paidAlone is false', async () => {
    const extract = jest.fn(async () => ({ amount: Money.fromCents(999), confidence: 1 }));
    await withApp(
      async (t) => {
        const res = await request(t.app.getHttpServer())
          .post('/receipts')
          .set(...bearer(session))
          .field('paidAlone', 'false')
          .attach('file', await pdfBytes(), { filename: 'c.pdf', contentType: 'application/pdf' });
        expect(res.status).toBe(201);
        expect(res.body.suggestedAmountCents).toBeNull();
        expect(extract).not.toHaveBeenCalled();
      },
      { [RECEIPT_EXTRACTOR]: { extract } satisfies ReceiptExtractor },
    );
  });

  it('calls the injected extractor once when paidAlone is true', async () => {
    const extract = jest.fn(async () => ({ amount: Money.fromCents(999), confidence: 1 }));
    await withApp(
      async (t) => {
        const res = await request(t.app.getHttpServer())
          .post('/receipts')
          .set(...bearer(session))
          .field('paidAlone', 'true')
          .attach('file', await pdfBytes(), { filename: 'c.pdf', contentType: 'application/pdf' });
        expect(res.body.suggestedAmountCents).toBe(999);
        expect(extract).toHaveBeenCalledTimes(1);
      },
      { [RECEIPT_EXTRACTOR]: { extract } satisfies ReceiptExtractor },
    );
  });

  it('answers 201 with null when the extractor blows up, keeping the file', async () => {
    const extract = jest.fn(async (): Promise<never> => {
      throw new Error('ocr exploded at /secret/path');
    });
    await withApp(
      async (t) => {
        const res = await request(t.app.getHttpServer())
          .post('/receipts')
          .set(...bearer(session))
          .field('paidAlone', 'true')
          .attach('file', await pdfBytes(), { filename: 'c.pdf', contentType: 'application/pdf' });
        expect(res.status).toBe(201);
        expect(res.body.suggestedAmountCents).toBeNull();
        expect(await readdir(uploadDirLocal)).toHaveLength(1);
      },
      { [RECEIPT_EXTRACTOR]: { extract } satisfies ReceiptExtractor },
    );
    for (const f of await readdir(uploadDirLocal)) await unlink(join(uploadDirLocal, f));
  });

  it('answers a generic 500 and leaves no orphan file when the database fails', async () => {
    const repo: ReceiptRepository = {
      save: async () => {
        throw new Error('db down: password=hunter2 at /srv/secret.ts');
      },
      findById: async () => null,
    };
    const errors: string[] = [];
    const spy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((...a: unknown[]) => void errors.push(a.map(String).join(' ')));
    try {
      await withApp(
        async (t) => {
          const res = await request(t.app.getHttpServer())
            .post('/receipts')
            .set(...bearer(session))
            .field('paidAlone', 'true')
            .attach('file', await pdfBytes(), {
              filename: 'segredo-do-cliente.pdf',
              contentType: 'application/pdf',
            });
          expect(res.status).toBe(500);
          expect(res.body).toEqual({
            statusCode: 500,
            error: 'Internal Server Error',
            message: 'Internal Server Error',
          });
          expect(res.text).not.toMatch(/hunter2|secret|\.ts|stack/);
          expect(await readdir(uploadDirLocal)).toEqual([]);
        },
        { [RECEIPT_REPOSITORY]: repo },
      );
    } finally {
      spy.mockRestore();
    }
    expect(errors.join('\n')).not.toMatch(/segredo-do-cliente|%PDF/);
  });

  it('answers a generic 500 without the path when the storage fails', async () => {
    const storage: FileStorage = {
      save: async () => {
        throw new Error(`ENOSPC: no space left on device, open '${uploadDirLocal}/x'`);
      },
      read: async () => Buffer.alloc(0),
      delete: async () => undefined,
    };
    await withApp(
      async (t) => {
        const res = await request(t.app.getHttpServer())
          .post('/receipts')
          .set(...bearer(session))
          .field('paidAlone', 'false')
          .attach('file', await pdfBytes(), { filename: 'c.pdf', contentType: 'application/pdf' });
        expect(res.status).toBe(500);
        expect(res.text).not.toContain(uploadDirLocal);
        expect(res.text).not.toMatch(/ENOSPC/);
      },
      { [FILE_STORAGE]: storage },
    );
  });
});

describe('receipts upload rate limit', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp({
      uploadDir: await mkdtemp(join(tmpdir(), 'fm-e2e-uploads-')),
      uploadThrottleLimit: 10,
    });
  });
  afterAll(async () => {
    await t.close();
  });

  it('answers 429 to the 11th upload of a user, but not to another user', async () => {
    await cleanTables(t.prisma);
    const ana = await signUp(t, 'ana@example.com');
    const bia = await signUp(t, 'bia@example.com');
    const pdf = await fixture('lixo.pdf');
    const send = (s: Session) =>
      request(t.app.getHttpServer())
        .post('/receipts')
        .set(...bearer(s))
        .field('paidAlone', 'false')
        .attach('file', pdf, { filename: 'c.pdf', contentType: 'application/pdf' });
    for (let i = 1; i <= 10; i++) expect((await send(ana)).status).toBe(201);
    const limited = await send(ana);
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Too Many Requests',
    });
    expect((await send(bia)).status).toBe(201);
    // Downloads are not upload-limited.
    const id = (await t.prisma.client.receipt.findFirstOrThrow({ where: { userId: ana.id } })).id;
    const dl = await request(t.app.getHttpServer())
      .get(`/receipts/${id}/file`)
      .set(...bearer(ana));
    expect(dl.status).toBe(200);
  });
});
