import { Expense } from '../../../domain/entities/expense';
import { NotFoundError, ValidationError } from '../../../domain/errors';
import { PaymentMethod } from '../../../domain/payment-method';
import { Actor } from '../../actor';
import { CategoryRepository } from '../../ports/category-repository';
import { Clock } from '../../ports/clock';
import { ExpenseRepository } from '../../ports/expense-repository';
import {
  requireVisibleCategory,
  toAmount,
  toDescription,
  toIsCardPayment,
  toPaidAlone,
  toPaymentMethod,
  toSpentAt,
} from './expense-input';
import { findOwnExpense } from './get-expense';

/** Editable fields only: `receiptId` and `userId` are immutable and not even read here. */
export interface UpdateExpenseInput {
  categoryId?: string;
  amountCents?: number;
  spentAt?: string;
  description?: string;
  paidAlone?: boolean;
  paymentMethod?: PaymentMethod;
  isCardPayment?: boolean;
}

export class UpdateExpense {
  constructor(
    private readonly expenses: ExpenseRepository,
    private readonly categories: CategoryRepository,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, id: string, input: UpdateExpenseInput): Promise<Expense> {
    const { categoryId, amountCents, spentAt, description, paidAlone, paymentMethod, isCardPayment } = input;
    const fields = [categoryId, amountCents, spentAt, description, paidAlone, paymentMethod, isCardPayment];
    if (fields.every((v) => v === undefined)) {
      throw new ValidationError('At least one field is required');
    }
    const amount = amountCents === undefined ? undefined : toAmount(amountCents);
    const date = spentAt === undefined ? undefined : toSpentAt(spentAt, this.clock);
    const text = description === undefined ? undefined : { value: toDescription(description) };
    const alone = paidAlone === undefined ? undefined : toPaidAlone(paidAlone);
    const method = paymentMethod === undefined ? undefined : toPaymentMethod(paymentMethod);
    const cardPayment = isCardPayment === undefined ? undefined : toIsCardPayment(isCardPayment);
    const current = await findOwnExpense(this.expenses, actor, id);
    const category =
      categoryId === undefined
        ? undefined
        : await requireVisibleCategory(this.categories, actor, categoryId);

    const updated = Expense.create({
      id: current.id,
      userId: current.userId,
      receiptId: current.receiptId,
      categoryId: category?.id ?? current.categoryId,
      amount: amount ?? current.amount,
      paidAlone: alone ?? current.paidAlone,
      paymentMethod: method ?? current.paymentMethod,
      // Expense.create checks the resulting pair, so changing only one side of it is validated too.
      isCardPayment: cardPayment ?? current.isCardPayment,
      spentAt: date ?? current.spentAt,
      description: text ? text.value : current.description,
      createdAt: current.createdAt,
    });
    // False means the expense vanished between the read and the write (concurrent delete).
    if (!(await this.expenses.update(updated))) throw new NotFoundError('Expense not found');
    return updated;
  }
}
