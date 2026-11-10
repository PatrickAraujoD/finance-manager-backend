import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { MAX_EXPENSE_CENTS } from '../../../domain/entities/expense';
import {
  MAX_EXPENSE_OFFSET,
  MAX_EXPENSE_PAGE,
} from '../../../application/use-cases/expenses/list-expenses';
import { PaymentMethod } from '../../../domain/payment-method';
import { CleanText } from './clean-text.decorator';

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
// Loose bound in UTF-16 units; the exact 500 character rule lives in the use case.
const DESCRIPTION_BOUND = 1000;
// Typed against the domain union so adding a method there forces this list to follow.
const PAYMENT_METHODS: readonly PaymentMethod[] = ['CREDIT', 'DEBIT', 'PIX', 'CASH'];
const present = (_: unknown, value: unknown) => value !== undefined;

/** Body of POST /expenses. Unknown fields (userId, id, createdAt...) are rejected by the pipe. */
export class CreateExpenseDto {
  @ValidateIf(present)
  @IsUUID()
  receiptId?: string;

  @IsUUID()
  categoryId!: string;

  /** The value the user confirmed: a JSON integer in 1..MAX_EXPENSE_CENTS (no strings). */
  @IsInt()
  @Min(1)
  @Max(MAX_EXPENSE_CENTS)
  amountCents!: number;

  @IsBoolean()
  paidAlone!: boolean;

  /** Required: CREDIT, DEBIT, PIX or CASH (exact, upper case). */
  @IsIn(PAYMENT_METHODS)
  paymentMethod!: PaymentMethod;

  /** Optional: true when this expense pays the credit card bill; absent means false. */
  @ValidateIf(present)
  @IsBoolean()
  isCardPayment?: boolean;

  /** `YYYY-MM-DD`; the use case checks that it is a real date and not too far ahead. */
  @IsString()
  @Matches(DATE_SHAPE)
  spentAt!: string;

  @ValidateIf(present)
  @IsString()
  @CleanText({ kind: 'description' })
  @MaxLength(DESCRIPTION_BOUND)
  description?: string;
}

/** Body of PATCH /expenses/:id. `receiptId` and `userId` are not here on purpose. */
export class UpdateExpenseDto {
  @ValidateIf(present)
  @IsUUID()
  categoryId?: string;

  @ValidateIf(present)
  @IsInt()
  @Min(1)
  @Max(MAX_EXPENSE_CENTS)
  amountCents?: number;

  @ValidateIf(present)
  @IsString()
  @Matches(DATE_SHAPE)
  spentAt?: string;

  @ValidateIf(present)
  @IsString()
  @CleanText({ kind: 'description' })
  @MaxLength(DESCRIPTION_BOUND)
  description?: string;

  @ValidateIf(present)
  @IsBoolean()
  paidAlone?: boolean;

  @ValidateIf(present)
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: PaymentMethod;

  @ValidateIf(present)
  @IsBoolean()
  isCardPayment?: boolean;
}

/** Query strings arrive as text: only plain digit strings become numbers, the rest fails IsInt. */
const digits = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' && /^\d{1,9}$/.test(value) ? Number(value) : value,
);

/**
 * Only the exact texts 'true' and 'false' become booleans; anything else (including a repeated
 * parameter, which arrives as an array) is left as is and fails IsBoolean with a 400.
 */
const exactBoolean = Transform(({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value,
);

export class ListExpensesQueryDto {
  @ValidateIf(present)
  @IsString()
  @Matches(DATE_SHAPE)
  from?: string;

  @ValidateIf(present)
  @IsString()
  @Matches(DATE_SHAPE)
  to?: string;

  @ValidateIf(present)
  @IsUUID()
  categoryId?: string;

  @ValidateIf(present)
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: PaymentMethod;

  @ValidateIf(present)
  @exactBoolean
  @IsBoolean()
  isCardPayment?: boolean;

  @ValidateIf(present)
  @digits
  @IsInt()
  @Min(1)
  @Max(MAX_EXPENSE_PAGE)
  limit?: number;

  @ValidateIf(present)
  @digits
  @IsInt()
  @Min(0)
  @Max(MAX_EXPENSE_OFFSET)
  offset?: number;
}
