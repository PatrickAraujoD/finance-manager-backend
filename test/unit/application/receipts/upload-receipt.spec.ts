import { ExtractionResult } from '../../../../src/application/ports/receipt-extractor';
import { UploadReceipt } from '../../../../src/application/use-cases/receipts/upload-receipt';
import { ValidationError } from '../../../../src/domain/errors';
import { Money } from '../../../../src/domain/money';
import { Role } from '../../../../src/domain/role';
import { FakeFileStorage } from '../../../support/fakes/fake-file-storage';
import { FakeFileTypeDetector } from '../../../support/fakes/fake-file-type-detector';
import { FakeReceiptExtractor } from '../../../support/fakes/fake-receipt-extractor';
import { FakeReceiptRepository } from '../../../support/fakes/fake-receipt-repository';
import { SequentialIdGenerator } from '../../../support/fakes/sequential-id-generator';

const ana = { id: 'ana', role: 'N' as Role };
const MB = 1024 * 1024;

const pdf = (extra = 100) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(extra, 0x41)]);
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(50)]);
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(50)]);

function setup(
  result: ExtractionResult = { amount: Money.fromCents(12345), confidence: 0.9 },
  options?: { extractionTimeoutMs?: number },
) {
  const storage = new FakeFileStorage();
  const receipts = new FakeReceiptRepository();
  const extractor = new FakeReceiptExtractor(result);
  const useCase = new UploadReceipt(
    storage,
    receipts,
    extractor,
    new FakeFileTypeDetector(),
    new SequentialIdGenerator(),
    options,
  );
  return { storage, receipts, extractor, useCase };
}

describe('UploadReceipt', () => {
  describe('paidAlone', () => {
    it('suggests the extracted amount and stores the receipt for the actor', async () => {
      const { useCase, receipts, storage, extractor } = setup();
      const out = await useCase.execute(ana, {
        file: pdf(),
        mimeType: 'application/pdf',
        paidAlone: true,
      });
      expect(out).toEqual({ receiptId: 'id-1', suggestedAmountCents: 12345 });
      expect(extractor.calls).toHaveLength(1);
      expect(extractor.calls[0].mimeType).toBe('application/pdf');
      const saved = await receipts.findById('id-1');
      expect(saved).toMatchObject({
        userId: 'ana',
        mimeType: 'application/pdf',
        sizeBytes: pdf().length,
      });
      expect(saved?.suggestedAmount?.cents).toBe(12345);
      expect(storage.keys).toEqual([saved?.storageKey]);
      expect(saved?.storageKey).toMatch(/\.pdf$/);
    });

    it('returns null when the extractor finds nothing', async () => {
      const { useCase } = setup({ amount: null, confidence: 0 });
      const out = await useCase.execute(ana, { file: pdf(), mimeType: 'application/pdf', paidAlone: true });
      expect(out.suggestedAmountCents).toBeNull();
    });

    it('never suggests a zero or negative amount', async () => {
      for (const cents of [0, -5]) {
        const { useCase, receipts } = setup({ amount: Money.fromCents(cents), confidence: 0.9 });
        const out = await useCase.execute(ana, {
          file: pdf(),
          mimeType: 'application/pdf',
          paidAlone: true,
        });
        expect(out.suggestedAmountCents).toBeNull();
        expect((await receipts.findById('id-1'))?.suggestedAmount).toBeNull();
      }
    });

    it('keeps the file and answers null when the extractor throws', async () => {
      const { useCase, extractor, storage, receipts } = setup();
      extractor.extract = async () => {
        throw new Error('ocr exploded');
      };
      const out = await useCase.execute(ana, { file: png(), mimeType: 'image/png', paidAlone: true });
      expect(out).toEqual({ receiptId: 'id-1', suggestedAmountCents: null });
      expect(storage.keys).toHaveLength(1);
      expect(await receipts.findById('id-1')).not.toBeNull();
    });

    it('keeps the file and answers null when the extractor hangs past the timeout', async () => {
      const { useCase, extractor, storage } = setup(undefined, { extractionTimeoutMs: 20 });
      extractor.extract = () => new Promise(() => undefined);
      const out = await useCase.execute(ana, { file: png(), mimeType: 'image/png', paidAlone: true });
      expect(out.suggestedAmountCents).toBeNull();
      expect(storage.keys).toHaveLength(1);
    });
  });

  describe('not paid alone', () => {
    it('stores the file, never calls the extractor and suggests nothing', async () => {
      const { useCase, extractor, receipts } = setup();
      const spy = jest.spyOn(extractor, 'extract');
      const out = await useCase.execute(ana, {
        file: pdf(),
        mimeType: 'application/pdf',
        paidAlone: false,
      });
      expect(out).toEqual({ receiptId: 'id-1', suggestedAmountCents: null });
      expect(spy).not.toHaveBeenCalled();
      expect((await receipts.findById('id-1'))?.suggestedAmount).toBeNull();
    });
  });

  describe('accepted types', () => {
    it.each([
      ['application/pdf', pdf(), 'pdf'],
      ['image/png', png(), 'png'],
      ['image/jpeg', jpeg(), 'jpg'],
    ])('accepts %s and stores it as .%s', async (mimeType, file, ext) => {
      const { useCase, receipts } = setup();
      const out = await useCase.execute(ana, { file, mimeType, paidAlone: false });
      expect((await receipts.findById(out.receiptId))?.storageKey).toMatch(new RegExp(`\\.${ext}$`));
    });
  });

  describe('rejections (nothing is stored, extractor never called)', () => {
    const rejected = async (file: Buffer, mimeType: string) => {
      const { useCase, storage, receipts, extractor } = setup();
      await expect(useCase.execute(ana, { file, mimeType, paidAlone: true })).rejects.toThrow(
        ValidationError,
      );
      expect(storage.keys).toHaveLength(0);
      expect(await receipts.findById('id-1')).toBeNull();
      expect(extractor.calls).toHaveLength(0);
    };

    it('an empty file', () => rejected(Buffer.alloc(0), 'application/pdf'));
    it('a file above 5 MB', () => rejected(pdf(5 * MB), 'application/pdf'));
    it('a fake PDF (a PNG declared as PDF)', () => rejected(png(), 'application/pdf'));
    it('a PDF declared as PNG', () => rejected(pdf(), 'image/png'));
    it('text declared as PDF', () => rejected(Buffer.from('hello'), 'application/pdf'));
    it('random bytes with an image mime', () => rejected(Buffer.alloc(100, 7), 'image/jpeg'));
    it('a real GIF', () => rejected(Buffer.from('GIF89a....'), 'image/gif'));
    it('a mime with parameters', () => rejected(pdf(), 'application/pdf; charset=utf-8'));
    it('an empty mime', () => rejected(pdf(), ''));

    it('accepts a file of exactly 5 MB', async () => {
      const { useCase } = setup();
      const file = pdf(5 * MB - pdf(0).length);
      expect(file.length).toBe(5 * MB);
      await expect(
        useCase.execute(ana, { file, mimeType: 'application/pdf', paidAlone: false }),
      ).resolves.toBeDefined();
    });
  });

  describe('failures after the file was saved', () => {
    it('removes the file when the receipt cannot be stored', async () => {
      const { useCase, receipts, storage } = setup();
      receipts.save = async () => {
        throw new Error('database down');
      };
      await expect(
        useCase.execute(ana, { file: pdf(), mimeType: 'application/pdf', paidAlone: true }),
      ).rejects.toThrow('database down');
      expect(storage.keys).toHaveLength(0);
    });

    it('still reports the original error if the cleanup fails too', async () => {
      const { useCase, receipts, storage } = setup();
      receipts.save = async () => {
        throw new Error('database down');
      };
      storage.delete = async () => {
        throw new Error('disk gone');
      };
      await expect(
        useCase.execute(ana, { file: pdf(), mimeType: 'application/pdf', paidAlone: false }),
      ).rejects.toThrow('database down');
    });
  });
});
