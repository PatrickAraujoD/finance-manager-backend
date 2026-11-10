import { LoanPayment as LoanPaymentRow, Prisma } from '@prisma/client';
import { LoanPaymentRepository } from '../../application/ports/loan-payment-repository';
import { LoanPayment } from '../../domain/entities/loan-payment';
import { ConflictError, NotFoundError, ValidationError } from '../../domain/errors';
import { Money } from '../../domain/money';
import { PrismaService } from './prisma.service';

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function toSafeNumber(value: bigint, what: string): number {
  // Never round a BIGINT: an unsafe value is an error (and only the internal log sees it).
  if (value > MAX_SAFE) throw new Error(`${what} is not a safe integer amount of cents`);
  return Number(value);
}

function toDomain(row: LoanPaymentRow): LoanPayment {
  return LoanPayment.create({
    id: row.id,
    loanId: row.loanId,
    userId: row.userId,
    amount: Money.fromCents(toSafeNumber(row.amountCents, `Stored loan payment ${row.id}`)),
    method: row.method,
    receiptId: row.receiptId,
    // DATE column: Prisma returns 00:00 UTC of the stored day.
    paidAt: row.paidAt,
    createdAt: row.createdAt,
  });
}

function errorCode(error: unknown): string | null {
  return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
}

function uniqueTarget(error: unknown): string[] {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return [];
  const target = error.meta?.target;
  return Array.isArray(target) ? target.map(String) : [String(target)];
}

// Under a burst the transaction may wait for a pooled connection or for the loan lock; the
// defaults (2 s / 5 s) are too tight for that, and a timeout would be a 500 for a valid request.
const TRANSACTION = { maxWait: 15_000, timeout: 15_000 };

export class PrismaLoanPaymentRepository implements LoanPaymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async add(payment: LoanPayment): Promise<void> {
    try {
      await this.prisma.client.$transaction(async (tx) => {
        // FOR UPDATE: payments to the SAME loan queue up here, so each one sees the sum left by
        // the previous one and the total can never pass the loan amount. Other loans are not
        // blocked. The owner is in the WHERE: someone else's loan is simply not found.
        const locked = await tx.$queryRaw<{ amountCents: bigint }[]>`
          SELECT "amountCents" FROM "Loan"
          WHERE "id" = ${payment.loanId} AND "userId" = ${payment.userId}
          FOR UPDATE`;
        if (locked.length === 0) throw new NotFoundError('Loan not found');
        const aggregate = await tx.loanPayment.aggregate({
          where: { loanId: payment.loanId },
          _sum: { amountCents: true },
        });
        const paid = aggregate._sum.amountCents ?? 0n;
        const remaining = locked[0].amountCents - paid;
        if (BigInt(payment.amount.cents) > remaining) {
          throw new ValidationError(
            `Payment of ${payment.amount.cents} cents exceeds the remaining balance of ${remaining} cents`,
          );
        }
        await tx.loanPayment.create({
          data: {
            id: payment.id,
            loanId: payment.loanId,
            userId: payment.userId,
            amountCents: BigInt(payment.amount.cents),
            method: payment.method,
            receiptId: payment.receiptId,
            paidAt: payment.paidAt,
          },
        });
      }, TRANSACTION);
    } catch (error) {
      const code = errorCode(error);
      if (code === 'P2002') {
        // UNIQUE(receiptId) or the primary key: a decision made by the database, race free.
        const message = uniqueTarget(error).includes('receiptId')
          ? 'Receipt already used by a payment'
          : 'Payment already exists';
        throw new ConflictError(message);
      }
      // FK violation: the receipt vanished (or never existed); loan and user were locked/read.
      if (code === 'P2003') throw new NotFoundError('Receipt not found');
      throw error;
    }
  }

  async listByLoan(userId: string, loanId: string): Promise<LoanPayment[]> {
    const rows = await this.prisma.client.loanPayment.findMany({
      where: { loanId, userId },
      orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toDomain);
  }

  async sumPaidByLoans(userId: string, loanIds?: readonly string[]): Promise<Map<string, number>> {
    const sums = new Map<string, number>();
    if (loanIds && loanIds.length === 0) return sums;
    // One GROUP BY for all the loans, never a query per loan.
    const groups = await this.prisma.client.loanPayment.groupBy({
      by: ['loanId'],
      where: { userId, ...(loanIds ? { loanId: { in: [...loanIds] } } : {}) },
      _sum: { amountCents: true },
    });
    for (const group of groups) {
      const total = group._sum.amountCents ?? 0n;
      sums.set(group.loanId, toSafeNumber(total, `Sum of the payments of loan ${group.loanId}`));
    }
    return sums;
  }

  async isReceiptUsed(receiptId: string): Promise<boolean> {
    return (await this.prisma.client.loanPayment.count({ where: { receiptId } })) > 0;
  }
}
