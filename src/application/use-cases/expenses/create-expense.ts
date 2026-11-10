import { Expense } from '../../../domain/entities/expense';
import { ConflictError, NotFoundError, ValidationError } from '../../../domain/errors';
import { PaymentMethod } from '../../../domain/payment-method';
import { Actor } from '../../actor';
import { CategoryRepository } from '../../ports/category-repository';
import { Clock } from '../../ports/clock';
import { ExpenseRepository } from '../../ports/expense-repository';
import { IdGenerator } from '../../ports/id-generator';
import { LoanPaymentRepository } from '../../ports/loan-payment-repository';
import { ReceiptRepository } from '../../ports/receipt-repository';
import {
  requireVisibleCategory,
  toAmount,
  toDescription,
  toIsCardPayment,
  toPaidAlone,
  toPaymentMethod,
  toSpentAt,
} from './expense-input';

export interface CreateExpenseInput {
  receiptId?: string;
  categoryId: string;
  /** Always the value the user typed or confirmed; a receipt suggestion is never used. */
  amountCents: number;
  paidAlone: boolean;
  paymentMethod: PaymentMethod;
  /** Optional: absent means false. Paying the card bill cannot use CREDIT. */
  isCardPayment?: boolean;
  /** `YYYY-MM-DD`, a real calendar date, at most today + 1 day (UTC). */
  spentAt: string;
  description?: string;
}

export class CreateExpense {
  constructor(
    private readonly expenses: ExpenseRepository,
    private readonly categories: CategoryRepository,
    private readonly receipts: ReceiptRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly loanPayments: LoanPaymentRepository,
  ) {}

  async execute(actor: Actor, input: CreateExpenseInput): Promise<{ id: string }> {
    // Pure input checks first (400), then lookups (404), then the write (409 on a used receipt).
    const amount = toAmount(input.amountCents);
    const spentAt = toSpentAt(input.spentAt, this.clock);
    const paidAlone = toPaidAlone(input.paidAlone);
    const paymentMethod = toPaymentMethod(input.paymentMethod);
    const isCardPayment = toIsCardPayment(input.isCardPayment);
    const description = input.description === undefined ? undefined : toDescription(input.description);
    const receiptId = input.receiptId ?? null;
    if (receiptId !== null && (typeof receiptId !== 'string' || receiptId.trim() === '')) {
      throw new ValidationError('receiptId must be a non blank text');
    }
    const category = await requireVisibleCategory(this.categories, actor, input.categoryId);
    if (receiptId !== null) {
      const receipt = await this.receipts.findById(receiptId);
      if (!receipt || receipt.userId !== actor.id) throw new NotFoundError('Receipt not found');
      // A receipt is proof of ONE payment: it cannot also back a loan payment. UNIQUE(receiptId)
      // on each table covers races within a table; this check covers the other table.
      if (await this.loanPayments.isReceiptUsed(receiptId)) {
        throw new ConflictError('Receipt already used by a loan payment');
      }
    }
    const expense = Expense.create({
      id: this.ids.next(),
      userId: actor.id,
      categoryId: category.id,
      receiptId,
      amount,
      paidAlone,
      paymentMethod,
      isCardPayment,
      spentAt,
      description,
    });
    // UNIQUE(receiptId) in the repository: two requests racing for one receipt, one wins.
    await this.expenses.save(expense);
    return { id: expense.id };
  }
}
