import { IsString, Matches } from 'class-validator';

// Strict YYYY-MM (month 01 to 12). A missing, repeated (array) or nested parameter is not a
// string, so it fails IsString: there is no silent default. Unknown parameters are rejected by
// the global pipe (forbidNonWhitelisted).
const MONTH_SHAPE = /^\d{4}-(0[1-9]|1[0-2])$/;

export class MonthQueryDto {
  @IsString()
  @Matches(MONTH_SHAPE)
  month!: string;
}

export class MonthRangeQueryDto {
  @IsString()
  @Matches(MONTH_SHAPE)
  from!: string;

  @IsString()
  @Matches(MONTH_SHAPE)
  to!: string;
}
