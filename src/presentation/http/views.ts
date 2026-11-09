import { CategoryReport } from '../../application/use-cases/reports/by-category';
import { DayReport } from '../../application/use-cases/reports/by-day';
import { LoanDetails } from '../../application/use-cases/loans/get-loan';
import { IncomeVsSpentReport } from '../../application/use-cases/reports/income-vs-spent';
import { EvolutionReport } from '../../application/use-cases/reports/monthly-evolution';
import { formatCalendarDate } from '../../domain/calendar-date';
import { LoanPayment } from '../../domain/entities/loan-payment';
import { Category } from '../../domain/entities/category';
import { Expense } from '../../domain/entities/expense';
import { User } from '../../domain/entities/user';
import { LoanStatus } from '../../domain/loan-balance';
import { LoanSummary, LoanSummaryTotals } from '../../domain/loan-summary';
import { LoanPaymentMethod } from '../../domain/loan-payment-method';
import { PaymentMethod } from '../../domain/payment-method';
import { Role } from '../../domain/role';

export interface UserView {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: Date | null;
}

/** Explicit field list: the password hash (or anything added to User later) never reaches a response. */
export function toUserView(user: User): UserView {
  return {
    id: user.id,
    name: user.name,
    email: user.email.value,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt,
  };
}

export interface CategoryView {
  id: string;
  name: string;
  global: boolean;
}

export function toCategoryView(category: Category): CategoryView {
  return { id: category.id, name: category.name, global: category.isGlobal() };
}

export interface ExpenseView {
  id: string;
  categoryId: string;
  receiptId: string | null;
  amountCents: number;
  paidAlone: boolean;
  paymentMethod: PaymentMethod;
  /** Calendar date, `YYYY-MM-DD`. */
  spentAt: string;
  description: string | null;
  createdAt: Date | null;
}

/** Explicit field list: `userId` and anything added to Expense later never reach a response. */
export function toExpenseView(expense: Expense): ExpenseView {
  return {
    id: expense.id,
    categoryId: expense.categoryId,
    receiptId: expense.receiptId,
    amountCents: expense.amount.cents,
    paidAlone: expense.paidAlone,
    paymentMethod: expense.paymentMethod,
    spentAt: formatCalendarDate(expense.spentAt),
    description: expense.description ?? null,
    createdAt: expense.createdAt,
  };
}

export interface LoanView {
  id: string;
  borrowerName: string;
  amountCents: number;
  /** Calendar date, `YYYY-MM-DD`. */
  dueDate: string;
  expenseId: string | null;
  paidCents: number;
  remainingCents: number;
  status: LoanStatus;
  createdAt: Date | null;
}

/** Explicit field list: `userId` and anything added to Loan later never reach a response. */
export function toLoanView({ loan, balance }: LoanDetails): LoanView {
  return {
    id: loan.id,
    borrowerName: loan.borrowerName,
    amountCents: loan.amount.cents,
    dueDate: formatCalendarDate(loan.dueDate),
    expenseId: loan.expenseId,
    paidCents: balance.paid.cents,
    remainingCents: balance.remaining.cents,
    status: balance.status,
    createdAt: loan.createdAt,
  };
}

export interface LoanPaymentView {
  id: string;
  loanId: string;
  amountCents: number;
  method: LoanPaymentMethod;
  receiptId: string | null;
  /** Calendar date, `YYYY-MM-DD`. */
  paidAt: string;
  createdAt: Date | null;
}

/** Explicit field list: `userId` and anything added to LoanPayment later never reach a response. */
export function toLoanPaymentView(payment: LoanPayment): LoanPaymentView {
  return {
    id: payment.id,
    loanId: payment.loanId,
    amountCents: payment.amount.cents,
    method: payment.method,
    receiptId: payment.receiptId,
    paidAt: formatCalendarDate(payment.paidAt),
    createdAt: payment.createdAt,
  };
}

export interface BorrowerSummaryView extends LoanSummaryTotals {
  borrowerName: string;
  loansCount: number;
  overdueLoansCount: number;
  /** Calendar date `YYYY-MM-DD` of the earliest loan with a balance; null when all are settled. */
  nextDueDate: string | null;
}

export interface LoanSummaryView {
  items: BorrowerSummaryView[];
  totals: LoanSummaryTotals;
  truncated: boolean;
}

/** Explicit field list for each person and for the totals; nothing else of the domain leaks. */
export function toLoanSummaryView(summary: LoanSummary): LoanSummaryView {
  return {
    items: summary.items.map((item) => ({
      borrowerName: item.borrowerName,
      loansCount: item.loansCount,
      totalLentCents: item.totalLentCents,
      paidCents: item.paidCents,
      owedCents: item.owedCents,
      upcomingCents: item.upcomingCents,
      overdueCents: item.overdueCents,
      overdueLoansCount: item.overdueLoansCount,
      nextDueDate: item.nextDueDate ? formatCalendarDate(item.nextDueDate) : null,
    })),
    totals: {
      totalLentCents: summary.totals.totalLentCents,
      paidCents: summary.totals.paidCents,
      owedCents: summary.totals.owedCents,
      upcomingCents: summary.totals.upcomingCents,
      overdueCents: summary.totals.overdueCents,
    },
    truncated: summary.truncated,
  };
}

export interface CategoryReportView {
  month: string;
  totalCents: number;
  items: { categoryId: string; categoryName: string; totalCents: number; percentage: number }[];
}

export function toCategoryReportView(report: CategoryReport): CategoryReportView {
  return {
    month: report.month,
    totalCents: report.totalCents,
    items: report.items.map((i) => ({
      categoryId: i.categoryId,
      categoryName: i.categoryName,
      totalCents: i.totalCents,
      percentage: i.percentage,
    })),
  };
}

export interface DayReportView {
  month: string;
  days: { date: string; totalCents: number }[];
  topDay: { date: string; totalCents: number } | null;
}

export function toDayReportView(report: DayReport): DayReportView {
  return {
    month: report.month,
    days: report.days.map((d) => ({ date: d.date, totalCents: d.totalCents })),
    topDay: report.topDay
      ? { date: report.topDay.date, totalCents: report.topDay.totalCents }
      : null,
  };
}

export interface EvolutionReportView {
  from: string;
  to: string;
  months: { month: string; totalCents: number }[];
}

export function toEvolutionReportView(report: EvolutionReport): EvolutionReportView {
  return {
    from: report.from,
    to: report.to,
    months: report.months.map((m) => ({ month: m.month, totalCents: m.totalCents })),
  };
}

export interface IncomeVsSpentView {
  month: string;
  incomeCents: number | null;
  spentCents: number;
  remainingCents: number | null;
  percentSpent: number | null;
}

export function toIncomeVsSpentView(report: IncomeVsSpentReport): IncomeVsSpentView {
  return {
    month: report.month,
    incomeCents: report.incomeCents,
    spentCents: report.spentCents,
    remainingCents: report.remainingCents,
    percentSpent: report.percentSpent,
  };
}
