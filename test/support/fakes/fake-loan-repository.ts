import { LoanFilter, LoanRepository } from '../../../src/application/ports/loan-repository';
import { Loan } from '../../../src/domain/entities/loan';
import { ConflictError } from '../../../src/domain/errors';

export class FakeLoanRepository implements LoanRepository {
  private readonly items = new Map<string, Loan>();

  async save(loan: Loan): Promise<void> {
    if (this.items.has(loan.id)) throw new ConflictError('Loan id already exists');
    if (
      loan.expenseId !== null &&
      [...this.items.values()].some((l) => l.expenseId === loan.expenseId)
    ) {
      throw new ConflictError('Expense already has a loan');
    }
    // Like the database, which stamps createdAt on insert.
    this.items.set(loan.id, this.stamped(loan));
  }
  async update(loan: Loan): Promise<boolean> {
    const current = this.items.get(loan.id);
    if (!current || current.userId !== loan.userId) return false;
    this.items.set(
      loan.id,
      Loan.create({
        id: current.id,
        userId: current.userId,
        borrowerName: loan.borrowerName,
        amount: current.amount,
        dueDate: loan.dueDate,
        expenseId: current.expenseId,
        createdAt: current.createdAt,
      }),
    );
    return true;
  }
  async findById(userId: string, id: string): Promise<Loan | null> {
    const l = this.items.get(id);
    return l && l.userId === userId ? l : null;
  }
  async listByUser(userId: string, filter: LoanFilter): Promise<Loan[]> {
    const borrower = filter.borrower?.toLowerCase();
    return [...this.items.values()]
      .filter(
        (l) =>
          l.userId === userId &&
          (borrower === undefined || l.borrowerName.toLowerCase() === borrower),
      )
      .sort((x, y) => x.dueDate.getTime() - y.dueDate.getTime() || (x.id < y.id ? -1 : 1));
  }
  async delete(userId: string, id: string): Promise<boolean> {
    const l = this.items.get(id);
    if (!l || l.userId !== userId) return false;
    this.items.delete(id);
    return true;
  }
  /** Test helper, not part of the port. */
  all(): Loan[] {
    return [...this.items.values()];
  }

  private stamped(loan: Loan): Loan {
    return Loan.create({
      id: loan.id,
      userId: loan.userId,
      borrowerName: loan.borrowerName,
      amount: loan.amount,
      dueDate: loan.dueDate,
      expenseId: loan.expenseId,
      createdAt: new Date(),
    });
  }
}
