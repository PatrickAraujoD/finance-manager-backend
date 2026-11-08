import { NotFoundError, StoredFileMissingError } from '../../../domain/errors';
import { Actor } from '../../actor';
import { FileStorage } from '../../ports/file-storage';
import { ReceiptRepository } from '../../ports/receipt-repository';
import { RECEIPT_EXTENSIONS } from './receipt-types';

export interface ReceiptFile {
  content: Buffer;
  /** The mime type recorded when the file was uploaded and checked; never sniffed again. */
  mimeType: string;
  /** Generated from the type: the name the client sent is never stored or reused. */
  fileName: string;
}

export class GetReceiptFile {
  constructor(
    private readonly receipts: ReceiptRepository,
    private readonly storage: FileStorage,
  ) {}

  /** Only the owner reads a receipt; anyone else (admins too) gets the same NotFound as a missing one. */
  async execute(actor: Actor, id: string): Promise<ReceiptFile> {
    const receipt = await this.receipts.findById(id);
    if (!receipt || receipt.userId !== actor.id) throw new NotFoundError('Receipt not found');
    let content: Buffer;
    try {
      content = await this.storage.read(receipt.storageKey);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new StoredFileMissingError(`Stored file of receipt ${receipt.id} is missing`);
      }
      throw error;
    }
    const ext = RECEIPT_EXTENSIONS[receipt.mimeType] ?? 'bin';
    return { content, mimeType: receipt.mimeType, fileName: `comprovante.${ext}` };
  }
}
