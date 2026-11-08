import { IsBoolean, IsIn, ValidateIf } from 'class-validator';
import { Role } from '../../../domain/role';

export class UpdateUserDto {
  // ValidateIf (not IsOptional) so an explicit null is rejected instead of silently skipped.
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['A', 'N'])
  role?: Role;

  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  active?: boolean;
}
