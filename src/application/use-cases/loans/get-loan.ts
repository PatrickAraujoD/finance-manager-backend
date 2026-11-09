import { Loan } from '../../../domain/entities/loan';
import { NotFoundError } from '../../../domain/errors';
import { computeLoanBalance, LoanBalance } from '../../../domain/loan-balance';
import { Money } from '../../../domain/money';
import { Actor } from '../../actor';
import { Clock } from '../../ports/clock';
import { LoanPaymentRepository } from '../../ports/loan-payment-repository';
import { LoanRepository } from '../../ports/loan-repository';

/** A loan together with what has been paid, what is left and whether it is late. */
export interface LoanDetails {
  loan: Loan;
  balance: LoanBalance;
}

/** Loads a loan of the actor. Someone else's (admins included) looks exactly like a missing one. */
export async function findOwnLoan(loans: LoanRepository, actor: Actor, id: string): Promise<Loan> {
  const loan = await loans.findById(actor.id, id);
  if (!loan) throw new NotFoundError('Loan not found');
  return loan;
}

export function withBalance(loan: Loan, paid: Money, now: Date): LoanDetails {
  return { loan, balance: computeLoanBalance(loan, paid, now) };
}

/** Balance of a single loan of the actor, from the real sum of its payments. */
export async function detailsOf(
  payments: LoanPaymentRepository,
  actor: Actor,
  loan: Loan,
  now: Date,
): Promise<LoanDetails> {
  const sums = await payments.sumPaidByLoans(actor.id, [loan.id]);
  return withBalance(loan, Money.fromCents(sums.get(loan.id) ?? 0), now);
}

export class GetLoan {
  constructor(
    private readonly loans: LoanRepository,
    private readonly payments: LoanPaymentRepository,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, id: string): Promise<LoanDetails> {
    const loan = await findOwnLoan(this.loans, actor, id);
    return detailsOf(this.payments, actor, loan, this.clock.now());
  }
}
