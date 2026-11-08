import { IsIn } from 'class-validator';

/** Multipart text fields are strings: only the literal `true` or `false` is accepted. */
export class UploadReceiptDto {
  @IsIn(['true', 'false'])
  paidAlone!: string;
}
