import { registerDecorator } from 'class-validator';
import { isValidMonth } from '../../../domain/entities/monthly-income';

// Strict YYYY-MM (month 01 to 12, year 1900 to 9998). A missing, repeated (array) or nested
// parameter is not a string, so it fails: there is no silent default. Unknown parameters are
// rejected by the global pipe (forbidNonWhitelisted).
function IsMonth(): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'isMonth',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: '$property must be a month in YYYY-MM format' },
      validator: { validate: (value: unknown) => isValidMonth(value) },
    });
  };
}

export class MonthQueryDto {
  @IsMonth()
  month!: string;
}

export class MonthRangeQueryDto {
  @IsMonth()
  from!: string;

  @IsMonth()
  to!: string;
}
