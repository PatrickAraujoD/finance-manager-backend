import { Prisma, Receipt as ReceiptRow } from '@prisma/client';
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

/** Unique violation on the primary key (not on storageKey, which must keep failing loudly). */
function isIdTaken(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target)];
  return fields.includes('id') || fields.includes('Receipt_pkey');
}

export class PrismaReceiptRepository implements ReceiptRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Inserts the receipt, or updates it when the id exists and is the user's own. There is no
   * read-then-write: the insert decides ownership atomically (the primary key), and the update
   * is filtered by owner and never touches `userId`. An id owned by someone else is a
   * ConflictError, never a transfer of ownership or an overwrite.
   */
  async save(receipt: Receipt): Promise<void> {
    const data = {
      storageKey: receipt.storageKey,
      mimeType: receipt.mimeType,
      sizeBytes: receipt.sizeBytes,
      suggestedAmountCents:
        receipt.suggestedAmount === null ? null : BigInt(receipt.suggestedAmount.cents),
    };
    try {
      await this.prisma.client.receipt.create({
        data: { id: receipt.id, userId: receipt.userId, ...data },
      });
    } catch (error) {
      if (!isIdTaken(error)) throw error;
      const updated = await this.prisma.client.receipt.updateMany({
        where: { id: receipt.id, userId: receipt.userId },
        data,
      });
      if (updated.count === 0) throw new ConflictError('Receipt belongs to another user');
    }
  }

  async findById(id: string): Promise<Receipt | null> {
    const row = await this.prisma.client.receipt.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }
}
