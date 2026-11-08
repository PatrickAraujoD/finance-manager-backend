import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import { CleanText } from './clean-text.decorator';

export const MAX_REFRESH_TOKEN_LENGTH = 512;

export class RegisterDto {
  @IsString()
  @CleanText()
  @Length(1, 100)
  name!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @CleanText()
  @Length(12, 128)
  password!: string;
}

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @CleanText()
  @Length(1, 128)
  password!: string;
}

export class RefreshTokenDto {
  @IsString()
  @CleanText()
  @Length(1, MAX_REFRESH_TOKEN_LENGTH)
  refreshToken!: string;
}
