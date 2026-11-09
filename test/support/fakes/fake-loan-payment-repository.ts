import { LoanPaymentRepository } from '../../../src/application/ports/loan-payment-repository';
import { LoanRepository } from '../../../src/application/ports/loan-repository';
import { LoanPayment } from '../../../src/domain/entities/loan-payment';
import { ConflictError, NotFoundError, ValidationError } from '../../../src/domain/errors';

/**
 * In-memory twin of the Prisma repository. It needs the loan repository to know each loan's
 * amount. `add` has no `await` between the balance check and the insert, so on the single JS
 * thread it is atomic, just like the row lock does in Postgres.
 */
export class FakeLoanPaymentRepository implements LoanPaymentRepository {
  private readonly items = new Map<string, LoanPayment>();

  constructor(private readonly loans: LoanRepository) {}

  async add(payment: LoanPayment): Promise<void> {
    const loan = await this.loans.findById(payment.userId, payment.loanId);
    // Everything below is synchronous: nothing can interleave between the check and the insert.
    if (!loan) throw new NotFoundError('Loan not found');
    if (this.items.has(payment.id)) throw new ConflictError('Payment id already exists');
    if (
      payment.receiptId !== null &&
      [...this.items.values()].some((p) => p.receiptId === payment.receiptId)
    ) {
      throw new ConflictError('Receipt already used by a payment');
    }
    const paid = this.paidOn(payment.loanId);
    if (paid + payment.amount.cents > loan.amount.cents) {
      throw new ValidationError('Payment exceeds the remaining balance of the loan');
    }
    // Like the database, which stamps createdAt on insert.
    this.items.set(
      payment.id,
      LoanPayment.create({
        id: payment.id,
        loanId: payment.loanId,
        userId: payment.userId,
        amount: payment.amount,
        method: payment.method,
        receiptId: payment.receiptId,
        paidAt: payment.paidAt,
        createdAt: new Date(),
      }),
    );
  }

  async listByLoan(userId: string, loanId: string): Promise<LoanPayment[]> {
    return [...this.items.values()]
      .filter((p) => p.userId === userId && p.loanId === loanId)
      .sort((x, y) => x.paidAt.getTime() - y.paidAt.getTime() || (x.id < y.id ? -1 : 1));
  }

  async sumPaidByLoans(userId: string, loanIds?: readonly string[]): Promise<Map<string, number>> {
    const sums = new Map<string, number>();
    for (const p of this.items.values()) {
      if (p.userId !== userId || (loanIds && !loanIds.includes(p.loanId))) continue;
      sums.set(p.loanId, (sums.get(p.loanId) ?? 0) + p.amount.cents);
    }
    return sums;
  }

  async isReceiptUsed(receiptId: string): Promise<boolean> {
    return [...this.items.values()].some((p) => p.receiptId === receiptId);
  }

  private paidOn(loanId: string): number {
    let total = 0;
    for (const p of this.items.values()) if (p.loanId === loanId) total += p.amount.cents;
    return total;
  }
}
