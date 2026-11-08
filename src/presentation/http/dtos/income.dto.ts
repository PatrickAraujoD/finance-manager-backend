import { IsInt, Max, Min } from 'class-validator';
import { MAX_INCOME_CENTS } from '../../../domain/entities/monthly-income';

/** `amountCents` must be a JSON number holding an integer in 1..MAX_INCOME_CENTS (no strings). */
export class SetIncomeDto {
  @IsInt()
  @Min(1)
  @Max(MAX_INCOME_CENTS)
  amountCents!: number;
}
