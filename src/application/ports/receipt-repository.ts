import { Receipt } from '../../domain/entities/receipt';

export interface ReceiptRepository {
  save(receipt: Receipt): Promise<void>;
  findById(id: string): Promise<Receipt | null>;
}
