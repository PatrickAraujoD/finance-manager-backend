import { Loan } from '../../../domain/entities/loan';
import { NotFoundError } from '../../../domain/errors';
import { computeLoanBalance, LoanBalance } from '../../../domain/loan-balance';
import { Money } from '../../../domain/money';
import { Actor } from '../../actor';
import { Clock } from '../../ports/clock';
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

export class GetLoan {
  constructor(
    private readonly loans: LoanRepository,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, id: string): Promise<LoanDetails> {
    const loan = await findOwnLoan(this.loans, actor, id);
    // No payments exist yet, so nothing has been paid.
    return withBalance(loan, Money.fromCents(0), this.clock.now());
  }
}
