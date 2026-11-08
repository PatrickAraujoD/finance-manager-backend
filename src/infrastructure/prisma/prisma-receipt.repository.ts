import { Receipt as ReceiptRow } from '@prisma/client';
import { ReceiptRepository } from '../../application/ports/receipt-repository';
import { Receipt } from '../../domain/entities/receipt';
import { ConflictError } from '../../domain/errors';
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

  /**
   * Inserts the receipt, or updates it when the id exists. An existing receipt keeps its owner:
   * saving the id as another user is a ConflictError, never a transfer of ownership.
   */
  async save(receipt: Receipt): Promise<void> {
    const existing = await this.prisma.client.receipt.findUnique({
      where: { id: receipt.id },
      select: { userId: true },
    });
    if (existing && existing.userId !== receipt.userId) {
      throw new ConflictError('Receipt belongs to another user');
    }
    const data = {
      storageKey: receipt.storageKey,
      mimeType: receipt.mimeType,
      sizeBytes: receipt.sizeBytes,
      suggestedAmountCents:
        receipt.suggestedAmount === null ? null : BigInt(receipt.suggestedAmount.cents),
    };
    await this.prisma.client.receipt.upsert({
      where: { id: receipt.id },
      create: { id: receipt.id, userId: receipt.userId, ...data },
      update: data,
    });
  }

  async findById(id: string): Promise<Receipt | null> {
    const row = await this.prisma.client.receipt.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }
}
