import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  MAX_LOAN_OFFSET,
  MAX_LOAN_PAGE,
  LoanStatusFilter,
} from '../../../application/use-cases/loans/list-loans';
import { MAX_BORROWER_NAME } from '../../../domain/entities/loan';
import { MAX_EXPENSE_CENTS } from '../../../domain/entities/expense';
import { CleanText } from './clean-text.decorator';

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
// Typed against the use case union so adding a status there forces this list to follow.
const STATUSES: readonly LoanStatusFilter[] = ['open', 'paid', 'overdue'];
const present = (_: unknown, value: unknown) => value !== undefined;

/**
 * Body of POST /loans. Send exactly one of `expenseId` (the amount is the expense's) or
 * `amountCents`; the use case answers 400 otherwise. Unknown fields (userId, id...) are rejected.
 */
export class CreateLoanDto {
  @IsString()
  @CleanText({ kind: 'name' })
  // Loose bound in UTF-16 units (an emoji is 2); the exact code point limit lives in the domain.
  @Length(1, MAX_BORROWER_NAME * 2)
  borrowerName!: string;

  /** `YYYY-MM-DD`; the use case checks that it is a real date from 2000 on. */
  @IsString()
  @Matches(DATE_SHAPE)
  dueDate!: string;

  @ValidateIf(present)
  @IsUUID()
  expenseId?: string;

  @ValidateIf(present)
  @IsInt()
  @Min(1)
  @Max(MAX_EXPENSE_CENTS)
  amountCents?: number;
}

/** Body of PATCH /loans/:id. The amount and the expense are immutable and not here on purpose. */
export class UpdateLoanDto {
  @ValidateIf(present)
  @IsString()
  @CleanText({ kind: 'name' })
  @Length(1, MAX_BORROWER_NAME * 2)
  borrowerName?: string;

  @ValidateIf(present)
  @IsString()
  @Matches(DATE_SHAPE)
  dueDate?: string;
}

/** Query strings arrive as text: only plain digit strings become numbers, the rest fails IsInt. */
const digits = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' && /^\d{1,9}$/.test(value) ? Number(value) : value,
);

export class ListLoansQueryDto {
  @ValidateIf(present)
  @IsString()
  @CleanText({ kind: 'name' })
  @Length(1, MAX_BORROWER_NAME * 2)
  borrower?: string;

  @ValidateIf(present)
  @IsIn(STATUSES)
  status?: LoanStatusFilter;

  @ValidateIf(present)
  @digits
  @IsInt()
  @Min(1)
  @Max(MAX_LOAN_PAGE)
  limit?: number;

  @ValidateIf(present)
  @digits
  @IsInt()
  @Min(0)
  @Max(MAX_LOAN_OFFSET)
  offset?: number;
}
