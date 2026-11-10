import { Loan as LoanRow, Prisma } from '@prisma/client';
import { LoanFilter, LoanRepository } from '../../application/ports/loan-repository';
import { Loan } from '../../domain/entities/loan';
import { ConflictError, NotFoundError } from '../../domain/errors';
import { Money } from '../../domain/money';
import { PrismaService } from './prisma.service';

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function toDomain(row: LoanRow): Loan {
  // Writes go through the domain, so this only trips on data written behind its back. Never
  // round a BIGINT: an unsafe value is an error.
  if (row.amountCents > MAX_SAFE) {
    // The id goes only to the internal log (the filter answers a generic 500).
    throw new Error(`Stored loan ${row.id} is not a safe integer amount of cents`);
  }
  return Loan.create({
    id: row.id,
    userId: row.userId,
    borrowerName: row.borrowerName,
    amount: Money.fromCents(Number(row.amountCents)),
    // DATE column: Prisma returns 00:00 UTC of the stored day.
    dueDate: row.dueDate,
    expenseId: row.expenseId,
    paymentMethod: row.paymentMethod,
    // DATE column, like dueDate.
    lentAt: row.lentAt,
    createdAt: row.createdAt,
  });
}

/**
 * Prisma runs `equals` + insensitive as ILIKE, where `%`, `_` and `\` are special. Escaping them
 * keeps the filter an exact comparison: "%" must not match every borrower.
 */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, '\\$&');
}

function errorCode(error: unknown): string | null {
  return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
}

function uniqueTarget(error: unknown): string[] {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return [];
  const target = error.meta?.target;
  return Array.isArray(target) ? target.map(String) : [String(target)];
}

export class PrismaLoanRepository implements LoanRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(loan: Loan): Promise<void> {
    try {
      await this.prisma.client.loan.create({
        data: {
          id: loan.id,
          userId: loan.userId,
          borrowerName: loan.borrowerName,
          amountCents: BigInt(loan.amount.cents),
          dueDate: loan.dueDate,
          expenseId: loan.expenseId,
          paymentMethod: loan.paymentMethod,
          lentAt: loan.lentAt,
        },
      });
    } catch (error) {
      const code = errorCode(error);
      if (code === 'P2002') {
        // UNIQUE(expenseId) or the primary key: a decision made by the database, race free.
        const message = uniqueTarget(error).includes('expenseId')
          ? 'Expense already has a loan'
          : 'Loan already exists';
        throw new ConflictError(message);
      }
      // FK violation: the user or the expense vanished (or never existed).
      if (code === 'P2003') throw new NotFoundError('User or expense not found');
      throw error;
    }
  }

  async update(loan: Loan): Promise<boolean> {
    const result = await this.prisma.client.loan.updateMany({
      // Owner in the WHERE: another user's id matches nothing. Only these two columns change.
      where: { id: loan.id, userId: loan.userId },
      data: { borrowerName: loan.borrowerName, dueDate: loan.dueDate },
    });
    return result.count > 0;
  }

  async findById(userId: string, id: string): Promise<Loan | null> {
    const row = await this.prisma.client.loan.findFirst({ where: { id, userId } });
    return row ? toDomain(row) : null;
  }

  async listByUser(userId: string, filter: LoanFilter): Promise<Loan[]> {
    const rows = await this.prisma.client.loan.findMany({
      where: {
        userId,
        ...(filter.borrower !== undefined
          ? { borrowerName: { equals: escapeLike(filter.borrower), mode: 'insensitive' as const } }
          : {}),
      },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toDomain);
  }

  async delete(userId: string, id: string): Promise<boolean> {
    try {
      const result = await this.prisma.client.loan.deleteMany({ where: { id, userId } });
      return result.count > 0;
    } catch (error) {
      // FK Restrict: payments were made toward this loan and still point at it.
      if (errorCode(error) === 'P2003') throw new ConflictError('Loan has payments');
      throw error;
    }
  }
}
