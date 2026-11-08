import { MonthlyIncome as MonthlyIncomeRow } from '@prisma/client';
import { IncomeRepository } from '../../application/ports/income-repository';
import { MonthlyIncome } from '../../domain/entities/monthly-income';
import { Money } from '../../domain/money';
import { PrismaService } from './prisma.service';

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function toDomain(row: MonthlyIncomeRow): MonthlyIncome {
  // Writes are validated by the domain, so this only trips on data written behind its back.
  if (row.amountCents > MAX_SAFE) {
    throw new Error('Stored income is not a safe integer amount of cents');
  }
  return MonthlyIncome.create({
    userId: row.userId,
    month: row.month,
    amount: Money.fromCents(Number(row.amountCents)),
  });
}

export class PrismaIncomeRepository implements IncomeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(income: MonthlyIncome): Promise<void> {
    const amountCents = BigInt(income.amount.cents);
    // A single INSERT ... ON CONFLICT DO UPDATE on the composite primary key: atomic, so two
    // concurrent upserts of the same month never fail; the last statement to commit wins.
    await this.prisma.client.monthlyIncome.upsert({
      where: { userId_month: { userId: income.userId, month: income.month } },
      create: { userId: income.userId, month: income.month, amountCents },
      update: { amountCents },
    });
  }

  async find(userId: string, month: string): Promise<MonthlyIncome | null> {
    const row = await this.prisma.client.monthlyIncome.findUnique({
      where: { userId_month: { userId, month } },
    });
    return row ? toDomain(row) : null;
  }
}
