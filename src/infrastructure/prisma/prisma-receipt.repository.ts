import { Receipt as ReceiptRow } from '@prisma/client';
import { ReceiptRepository } from '../../application/ports/receipt-repository';
import { Receipt } from '../../domain/entities/receipt';
import { Money } from '../../domain/money';
import { PrismaService } from './prisma.service';

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function toDomain(row: ReceiptRow): Receipt {
  // Writes are validated by the domain, so this only trips on data written behind its back.
  if (row.suggestedAmountCents !== null && row.suggestedAmountCents > MAX_SAFE) {
    throw new Error('Stored suggestion is not a safe integer amount of cents');
  }
  return Receipt.create({
    id: row.id,
    userId: row.userId,
    storageKey: row.storageKey,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    suggestedAmount:
      row.suggestedAmountCents === null ? null : Money.fromCents(Number(row.suggestedAmountCents)),
  });
}

export class PrismaReceiptRepository implements ReceiptRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(receipt: Receipt): Promise<void> {
    const data = {
      userId: receipt.userId,
      storageKey: receipt.storageKey,
      mimeType: receipt.mimeType,
      sizeBytes: receipt.sizeBytes,
      suggestedAmountCents:
        receipt.suggestedAmount === null ? null : BigInt(receipt.suggestedAmount.cents),
    };
    await this.prisma.client.receipt.upsert({
      where: { id: receipt.id },
      create: { id: receipt.id, ...data },
      update: data,
    });
  }

  async findById(id: string): Promise<Receipt | null> {
    const row = await this.prisma.client.receipt.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }
}
