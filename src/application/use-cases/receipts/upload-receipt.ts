import { Receipt } from '../../../domain/entities/receipt';
import { ValidationError } from '../../../domain/errors';
import { Money } from '../../../domain/money';
import { Actor } from '../../actor';
import { FileStorage } from '../../ports/file-storage';
import { FileTypeDetector } from '../../ports/file-type-detector';
import { IdGenerator } from '../../ports/id-generator';
import { ReceiptExtractor } from '../../ports/receipt-extractor';
import { ReceiptRepository } from '../../ports/receipt-repository';
import { RECEIPT_EXTENSIONS } from './receipt-types';

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const DEFAULT_EXTRACTION_TIMEOUT_MS = 45_000;

export interface UploadReceiptInput {
  file: Buffer;
  mimeType: string;
  paidAlone: boolean;
}

export interface UploadReceiptOutput {
  receiptId: string;
  suggestedAmountCents: number | null;
}

export class UploadReceipt {
  private readonly extractionTimeoutMs: number;

  constructor(
    private readonly storage: FileStorage,
    private readonly receipts: ReceiptRepository,
    private readonly extractor: ReceiptExtractor,
    private readonly fileTypes: FileTypeDetector,
    private readonly ids: IdGenerator,
    options: { extractionTimeoutMs?: number } = {},
  ) {
    this.extractionTimeoutMs = options.extractionTimeoutMs ?? DEFAULT_EXTRACTION_TIMEOUT_MS;
  }

  async execute(actor: Actor, input: UploadReceiptInput): Promise<UploadReceiptOutput> {
    const ext = await this.validate(input);

    const storageKey = await this.storage.save(input.file, ext);
    try {
      // The extractor only ever runs for a receipt the user paid alone; otherwise the amount
      // is whatever the user types, so there is nothing to suggest.
      const suggested = input.paidAlone ? await this.suggestAmount(input) : null;
      const receipt = Receipt.create({
        id: this.ids.next(),
        userId: actor.id,
        storageKey,
        mimeType: input.mimeType,
        sizeBytes: input.file.length,
        suggestedAmount: suggested,
      });
      await this.receipts.save(receipt);
      return { receiptId: receipt.id, suggestedAmountCents: suggested?.cents ?? null };
    } catch (error) {
      // No orphan files: if the receipt was not stored, neither is the file.
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  /** Checks size and the real type (magic bytes) against the declared one; returns the ext. */
  private async validate(input: UploadReceiptInput): Promise<string> {
    const { file, mimeType } = input;
    if (file.length === 0) throw new ValidationError('The file is empty');
    if (file.length > MAX_RECEIPT_BYTES) throw new ValidationError('The file exceeds 5 MB');
    const ext = RECEIPT_EXTENSIONS[mimeType];
    if (ext === undefined) throw new ValidationError('Only PDF, PNG and JPEG are accepted');
    const real = await this.fileTypes.detect(file);
    if (real !== mimeType) throw new ValidationError('The file content does not match its type');
    return ext;
  }

  /** Never throws: an unreadable receipt or a slow extractor just means no suggestion. */
  private async suggestAmount(input: UploadReceiptInput): Promise<Money | null> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Extraction timed out')), this.extractionTimeoutMs);
      });
      const result = await Promise.race([
        this.extractor.extract(input.file, input.mimeType),
        timeout,
      ]);
      return result.amount !== null && result.amount.cents > 0 ? result.amount : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
