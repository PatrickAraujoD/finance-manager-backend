import { IsBoolean, IsString, Length, ValidateIf } from 'class-validator';
import { MAX_CATEGORY_NAME } from '../../../domain/entities/category';
import { CleanText } from './clean-text.decorator';

export class CreateCategoryDto {
  @IsString()
  @CleanText()
  // Loose bound in UTF-16 units (an emoji is 2); the exact code point limit lives in the domain.
  @Length(1, MAX_CATEGORY_NAME * 2)
  name!: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  global?: boolean;
}

export class UpdateCategoryDto {
  @IsString()
  @CleanText()
  // Loose bound in UTF-16 units (an emoji is 2); the exact code point limit lives in the domain.
  @Length(1, MAX_CATEGORY_NAME * 2)
  name!: string;
}
