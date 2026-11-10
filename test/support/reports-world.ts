import { Category } from '../../src/domain/entities/category';
import { Expense, MAX_EXPENSE_CENTS } from '../../src/domain/entities/expense';
import { Loan } from '../../src/domain/entities/loan';
import { LoanPayment } from '../../src/domain/entities/loan-payment';
import { MonthlyIncome } from '../../src/domain/entities/monthly-income';
import { Money } from '../../src/domain/money';
import { PaymentMethod } from '../../src/domain/payment-method';
import { Role } from '../../src/domain/role';
import { FakeCategoryRepository } from './fakes/fake-category-repository';
import { FakeExpenseRepository } from './fakes/fake-expense-repository';
import { FakeIncomeRepository } from './fakes/fake-income-repository';
import { FakeLoanPaymentRepository } from './fakes/fake-loan-payment-repository';
import { FakeLoanRepository } from './fakes/fake-loan-repository';
import { FakeReportRepository } from './fakes/fake-report-repository';

export const ana = { id: 'ana', role: 'N' as Role };
export const bob = { id: 'bob', role: 'N' as Role };
export const admin = { id: 'admin', role: 'A' as Role };

/** In-memory data for the report use cases: fakes plus tiny helpers to seed them. */
export function reportsWorld() {
  const expenses = new FakeExpenseRepository();
  const categories = new FakeCategoryRepository(expenses);
  const incomes = new FakeIncomeRepository();
  const loans = new FakeLoanRepository();
  const loanPayments = new FakeLoanPaymentRepository(loans);
  const reports = new FakeReportRepository(expenses, categories, loanPayments);
  const lenders = new Set<string>();
  let counter = 0;

  return {
    expenses,
    categories,
    incomes,
    reports,
    loans,
    loanPayments,
    async category(id: string, name: string, ownerId: string | null = null): Promise<void> {
      await categories.save(Category.create({ id, name, ownerId }));
    },
    async spend(
      userId: string,
      categoryId: string,
      cents: number,
      date: string,
      how: { paymentMethod?: PaymentMethod; isCardPayment?: boolean } = {},
    ): Promise<void> {
      await expenses.save(
        Expense.create({
          id: `e${++counter}`,
          userId,
          categoryId,
          receiptId: null,
          amount: Money.fromCents(cents),
          paidAlone: true,
          paymentMethod: how.paymentMethod ?? 'PIX',
          isCardPayment: how.isCardPayment ?? false,
          spentAt: new Date(`${date}T00:00:00Z`),
        }),
      );
    },
    /** A CASH payment received on a (lazily created, never exhausted) loan of the user. */
    async receive(userId: string, cents: number, date: string): Promise<void> {
      const loanId = `loan-${userId}`;
      if (!lenders.has(userId)) {
        lenders.add(userId);
        await loans.save(
          Loan.create({
            id: loanId,
            userId,
            borrowerName: 'Borrower',
            amount: Money.fromCents(MAX_EXPENSE_CENTS),
            dueDate: new Date('2099-01-01T00:00:00Z'),
            expenseId: null,
            paymentMethod: 'CASH',
            lentAt: new Date('2000-01-01T00:00:00Z'),
          }),
        );
      }
      await loanPayments.add(
        LoanPayment.create({
          id: `p${++counter}`,
          loanId,
          userId,
          amount: Money.fromCents(cents),
          method: 'CASH',
          receiptId: null,
          paidAt: new Date(`${date}T00:00:00Z`),
        }),
      );
    },
    /** Money lent directly (no expense), on a distinct loan per call. */
    async lend(
      userId: string,
      cents: number,
      lentAt: string,
      paymentMethod: PaymentMethod = 'PIX',
    ): Promise<void> {
      await loans.save(
        Loan.create({
          id: `direct-${++counter}`,
          userId,
          borrowerName: 'Carlos',
          amount: Money.fromCents(cents),
          dueDate: new Date('2099-01-01T00:00:00Z'),
          expenseId: null,
          paymentMethod,
          lentAt: new Date(`${lentAt}T00:00:00Z`),
        }),
      );
    },
    /** A loan born from an expense: it carries no method or date, the expense already counts. */
    async lendFromExpense(userId: string, expenseId: string, cents: number): Promise<void> {
      await loans.save(
        Loan.create({
          id: `born-${++counter}`,
          userId,
          borrowerName: 'Carlos',
          amount: Money.fromCents(cents),
          dueDate: new Date('2099-01-01T00:00:00Z'),
          expenseId,
          paymentMethod: null,
          lentAt: null,
        }),
      );
    },
    async earn(userId: string, month: string, cents: number): Promise<void> {
      await incomes.upsert(MonthlyIncome.create({ userId, month, amount: Money.fromCents(cents) }));
    },
  };
}
