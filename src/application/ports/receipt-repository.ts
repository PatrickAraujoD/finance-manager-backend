import { Receipt } from '../../domain/entities/receipt';

export interface ReceiptRepository {
  /** Upsert: inserts or replaces the receipt with the same id. */
  save(receipt: Receipt): Promise<void>;
  findById(id: string): Promise<Receipt | null>;
}
