import { IsBoolean, IsString, Length, ValidateIf } from 'class-validator';
import { MAX_CATEGORY_NAME } from '../../../domain/entities/category';
import { CleanText } from './clean-text.decorator';

export class CreateCategoryDto {
  @IsString()
  @CleanText()
  @Length(1, MAX_CATEGORY_NAME)
  name!: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  global?: boolean;
}

export class UpdateCategoryDto {
  @IsString()
  @CleanText()
  @Length(1, MAX_CATEGORY_NAME)
  name!: string;
}
