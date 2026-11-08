import { Receipt } from '../../../src/domain/entities/receipt';
import { ReceiptRepository } from '../../../src/application/ports/receipt-repository';

export class FakeReceiptRepository implements ReceiptRepository {
  private readonly items = new Map<string, Receipt>();

  async save(receipt: Receipt): Promise<void> {
    this.items.set(receipt.id, receipt);
  }
  async findById(id: string): Promise<Receipt | null> {
    return this.items.get(id) ?? null;
  }
}
