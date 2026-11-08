import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { FileTypeLibDetector } from '../../../src/infrastructure/extraction/file-type-detector';
import { ValidationError } from '../../../src/domain/errors';
import { UploadReceipt } from '../../../src/application/use-cases/receipts/upload-receipt';
import { FakeFileStorage } from '../../support/fakes/fake-file-storage';
import { FakeReceiptExtractor } from '../../support/fakes/fake-receipt-extractor';
import { FakeReceiptRepository } from '../../support/fakes/fake-receipt-repository';
import { SequentialIdGenerator } from '../../support/fakes/sequential-id-generator';

const fixture = (name: string) => readFileSync(join(__dirname, '..', '..', 'fixtures', name));

// ASF/WMV container whose first sub-header has size 0: file-type@16 spun on it forever.
function asfBomb(): Buffer {
  const header = Buffer.from('3026B2758E66CF11A6D900AA0062CE6C', 'hex');
  return Buffer.concat([header, Buffer.alloc(14 + 16 + 8 + 200)]);
}

describe('FileTypeLibDetector (magic bytes)', () => {
  const detector = new FileTypeLibDetector();

  it('detects PDF, PNG and JPEG', async () => {
    expect(await detector.detect(fixture('comprovante-texto.pdf'))).toBe('application/pdf');
    expect(await detector.detect(fixture('comprovante.png'))).toBe('image/png');
    const jpeg = createCanvas(10, 10).toBuffer('image/jpeg');
    expect(await detector.detect(jpeg)).toBe('image/jpeg');
  });

  it('ignores the file name: a PNG named .pdf is a PNG', async () => {
    expect(await detector.detect(fixture('falso.pdf'))).toBe('image/png');
  });

  it('returns null for text, empty and random bytes', async () => {
    expect(await detector.detect(Buffer.from('just some text'))).toBeNull();
    expect(await detector.detect(Buffer.alloc(0))).toBeNull();
    expect(await detector.detect(Buffer.alloc(64, 0xab))).toBeNull();
  });

  it.each([
    ['GIF', Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1')],
    ['WEBP', Buffer.from('RIFF\x24\x00\x00\x00WEBPVP8 ', 'latin1')],
    ['ZIP', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0])],
    ['ELF', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0])],
  ])('accepts only the three known types: %s is null', async (_name, buffer) => {
    expect(await detector.detect(buffer)).toBeNull();
  });

  it.each([
    ['1 byte', Buffer.from([0x89])],
    ['8 bytes of zeros', Buffer.alloc(8)],
    ['10 bytes of zeros', Buffer.alloc(10)],
    ['short TIFF', Buffer.from([0x49, 0x49, 0x2a, 0x00])],
    ['short TIFF big endian', Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00])],
    ['truncated PNG signature', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a])],
    ['PNG start with a wrong tail', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0])],
    ['truncated JPEG', Buffer.from([0xff, 0xd8])],
    ['truncated PDF marker', Buffer.from('%PDF')],
    ['PDF marker not at offset 0', Buffer.from(' %PDF-1.4')],
  ])('never throws on short or odd input: %s', async (_name, buffer) => {
    await expect(detector.detect(buffer)).resolves.toBeNull();
  });

  it('answers a malformed ASF container immediately', async () => {
    const started = Date.now();
    expect(await detector.detect(asfBomb())).toBeNull();
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('makes the upload use case answer ValidationError, never a crash', async () => {
    const useCase = new UploadReceipt(
      new FakeFileStorage(),
      new FakeReceiptRepository(),
      new FakeReceiptExtractor({ amount: null, confidence: 0 }),
      detector,
      new SequentialIdGenerator(),
    );
    const actor = { id: 'ana', role: 'N' as const };
    for (const file of [asfBomb(), Buffer.alloc(8), Buffer.from([0x49, 0x49, 0x2a, 0x00])]) {
      await expect(
        useCase.execute(actor, { file, mimeType: 'image/png', paidAlone: true }),
      ).rejects.toThrow(ValidationError);
    }
  });
});
