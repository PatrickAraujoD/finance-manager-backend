import { Expense as ExpenseRow, Prisma } from '@prisma/client';
import {
  ExpenseFilter,
  ExpensePage,
  ExpenseRepository,
} from '../../application/ports/expense-repository';
import { Expense } from '../../domain/entities/expense';
import { ConflictError, NotFoundError } from '../../domain/errors';
import { Money } from '../../domain/money';
import { PrismaService } from './prisma.service';

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function toDomain(row: ExpenseRow): Expense {
  // Writes go through the domain, so this only trips on data written behind its back. Never
  // round a BIGINT: an unsafe value is an error.
  if (row.amountCents > MAX_SAFE) {
    // The id goes only to the internal log (the filter answers a generic 500).
    throw new Error(`Stored expense ${row.id} is not a safe integer amount of cents`);
  }
  return Expense.create({
    id: row.id,
    userId: row.userId,
    categoryId: row.categoryId,
    receiptId: row.receiptId,
    amount: Money.fromCents(Number(row.amountCents)),
    paidAlone: row.paidAlone,
    paymentMethod: row.paymentMethod,
    // DATE column: Prisma returns 00:00 UTC of the stored day.
    spentAt: row.spentAt,
    description: row.description ?? undefined,
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

function where(userId: string, filter: ExpenseFilter): Prisma.ExpenseWhereInput {
  const spentAt: Prisma.DateTimeFilter = {};
  if (filter.from) spentAt.gte = filter.from;
  if (filter.to) spentAt.lte = filter.to;
  return {
    userId,
    ...(filter.from || filter.to ? { spentAt } : {}),
    ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
    ...(filter.paymentMethod ? { paymentMethod: filter.paymentMethod } : {}),
  };
}

export class PrismaExpenseRepository implements ExpenseRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(expense: Expense): Promise<void> {
    try {
      await this.prisma.client.expense.create({
        data: {
          id: expense.id,
          userId: expense.userId,
          categoryId: expense.categoryId,
          receiptId: expense.receiptId,
          amountCents: BigInt(expense.amount.cents),
          paidAlone: expense.paidAlone,
          paymentMethod: expense.paymentMethod,
          spentAt: expense.spentAt,
          description: expense.description ?? null,
        },
      });
    } catch (error) {
      const code = errorCode(error);
      if (code === 'P2002') {
        // UNIQUE(receiptId) or the primary key: a decision made by the database, race free.
        const message = uniqueTarget(error).includes('receiptId')
          ? 'Receipt already used by an expense'
          : 'Expense already exists';
        throw new ConflictError(message);
      }
      // FK violation: the category or the receipt vanished (or never existed).
      if (code === 'P2003') throw new NotFoundError('Category or receipt not found');
      throw error;
    }
  }

  async update(expense: Expense): Promise<boolean> {
    try {
      const result = await this.prisma.client.expense.updateMany({
        // Owner in the WHERE: another user's id matches nothing. userId/receiptId never change.
        where: { id: expense.id, userId: expense.userId },
        data: {
          categoryId: expense.categoryId,
          amountCents: BigInt(expense.amount.cents),
          paidAlone: expense.paidAlone,
          paymentMethod: expense.paymentMethod,
          spentAt: expense.spentAt,
          description: expense.description ?? null,
        },
      });
      return result.count > 0;
    } catch (error) {
      if (errorCode(error) === 'P2003') throw new NotFoundError('Category not found');
      throw error;
    }
  }

  async findById(userId: string, id: string): Promise<Expense | null> {
    const row = await this.prisma.client.expense.findFirst({ where: { id, userId } });
    return row ? toDomain(row) : null;
  }

  async listByUser(userId: string, filter: ExpenseFilter, page?: ExpensePage): Promise<Expense[]> {
    const rows = await this.prisma.client.expense.findMany({
      where: where(userId, filter),
      orderBy: [{ spentAt: 'desc' }, { id: 'desc' }],
      ...(page ? { take: page.limit, skip: page.offset } : {}),
    });
    return rows.map(toDomain);
  }

  countByUser(userId: string, filter: ExpenseFilter): Promise<number> {
    return this.prisma.client.expense.count({ where: where(userId, filter) });
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const result = await this.prisma.client.expense.deleteMany({ where: { id, userId } });
    return result.count > 0;
  }
}
