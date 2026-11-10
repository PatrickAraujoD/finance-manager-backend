import { LoanPayment } from '../../domain/entities/loan-payment';

export interface LoanPaymentRepository {
  /**
   * Inserts a payment ATOMICALLY with the balance check: with the loan locked, the sum of its
   * payments plus this one must not exceed the loan amount, so two simultaneous requests whose
   * total overshoots can never both pass. Throws `ValidationError` when the payment is greater
   * than the remaining balance, `NotFoundError` when the loan does not exist or is not owned by
   * `payment.userId`, and `ConflictError` when the id exists or the receipt already backs another
   * payment (UNIQUE receiptId, race free).
   */
  add(payment: LoanPayment): Promise<void>;
  /** Payments of the loan, only when the loan belongs to `userId`; paidAt then id ascending. */
  listByLoan(userId: string, loanId: string): Promise<LoanPayment[]>;
  /**
   * Cents paid per loan id, in ONE aggregated query. Loans without payments are absent from the
   * map (read them as zero). Without `loanIds` it covers every loan of `userId`; an empty list
   * covers none. Only payments of `userId` count.
   */
  sumPaidByLoans(userId: string, loanIds?: readonly string[]): Promise<Map<string, number>>;
  /** True when any payment (of any user) uses this receipt. */
  isReceiptUsed(receiptId: string): Promise<boolean>;
}
