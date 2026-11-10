import { LoanPayment } from '../../../domain/entities/loan-payment';
import { ConflictError, NotFoundError, ValidationError } from '../../../domain/errors';
import { LoanPaymentMethod, parseLoanPaymentMethod } from '../../../domain/loan-payment-method';
import { Actor } from '../../actor';
import { Clock } from '../../ports/clock';
import { ExpenseRepository } from '../../ports/expense-repository';
import { IdGenerator } from '../../ports/id-generator';
import { LoanPaymentRepository } from '../../ports/loan-payment-repository';
import { LoanRepository } from '../../ports/loan-repository';
import { ReceiptRepository } from '../../ports/receipt-repository';
import { toAmount } from '../expenses/expense-input';
import { findOwnLoan } from './get-loan';
import { toPaidAt } from './loan-input';

export interface RegisterLoanPaymentInput {
  loanId: string;
  /** What the user typed or confirmed, in cents: 1..MAX_EXPENSE_CENTS. */
  amountCents: number;
  /** CASH is physical money (no receipt); PIX needs the id of an uploaded receipt. */
  method: LoanPaymentMethod;
  /** `YYYY-MM-DD`, from 2000-01-01 to today + 1 day (UTC). */
  paidAt: string;
  receiptId?: string;
}

export class RegisterLoanPayment {
  constructor(
    private readonly loans: LoanRepository,
    private readonly payments: LoanPaymentRepository,
    private readonly receipts: ReceiptRepository,
    private readonly expenses: ExpenseRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, input: RegisterLoanPaymentInput): Promise<{ id: string }> {
    // Pure input checks first (400), then the lookups (404), then the conflicts (409) and the
    // balance (400), which the repository decides atomically at the write.
    const amount = toAmount(input.amountCents);
    if (typeof input.method !== 'string') throw new ValidationError('method must be CASH or PIX');
    const method = parseLoanPaymentMethod(input.method);
    const paidAt = toPaidAt(input.paidAt, this.clock);
    const receiptId = input.receiptId ?? null;
    if (method === 'PIX') {
      if (typeof receiptId !== 'string' || receiptId.trim() === '') {
        throw new ValidationError('A PIX payment requires a receiptId');
      }
    } else if (receiptId !== null) {
      throw new ValidationError('A CASH payment cannot have a receiptId');
    }

    const loan = await findOwnLoan(this.loans, actor, input.loanId);
    if (receiptId !== null) {
      // Someone else's receipt looks exactly like a missing one.
      const receipt = await this.receipts.findById(receiptId);
      if (!receipt || receipt.userId !== actor.id) throw new NotFoundError('Receipt not found');
      if (await this.expenses.isReceiptUsed(receiptId)) {
        throw new ConflictError('Receipt already used by an expense');
      }
      if (await this.payments.isReceiptUsed(receiptId)) {
        throw new ConflictError('Receipt already used by a payment');
      }
    }
    const payment = LoanPayment.create({
      id: this.ids.next(),
      loanId: loan.id,
      userId: actor.id,
      amount,
      method,
      receiptId,
      paidAt,
    });
    // The pre-checks above give friendly answers; UNIQUE(receiptId) and the locked balance check
    // inside `add` are what keep two simultaneous requests from both passing.
    await this.payments.add(payment);
    return { id: payment.id };
  }
}
