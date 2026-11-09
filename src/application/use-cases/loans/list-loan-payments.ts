import { LoanPayment } from '../../../domain/entities/loan-payment';
import { Actor } from '../../actor';
import { LoanPaymentRepository } from '../../ports/loan-payment-repository';
import { LoanRepository } from '../../ports/loan-repository';
import { findOwnLoan } from './get-loan';

/** Payments of a loan of the actor, oldest first. Someone else's loan is a NotFoundError. */
export class ListLoanPayments {
  constructor(
    private readonly loans: LoanRepository,
    private readonly payments: LoanPaymentRepository,
  ) {}

  async execute(actor: Actor, loanId: string): Promise<LoanPayment[]> {
    await findOwnLoan(this.loans, actor, loanId);
    return this.payments.listByLoan(actor.id, loanId);
  }
}
