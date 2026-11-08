import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { GetReceiptFile } from '../../../application/use-cases/receipts/get-receipt-file';
import {
  MAX_RECEIPT_BYTES,
  UploadReceipt,
  UploadReceiptOutput,
} from '../../../application/use-cases/receipts/upload-receipt';
import { AuthenticatedUser, CurrentUser } from '../decorators/current-user.decorator';
import { UploadThrottle } from '../decorators/strict-throttle.decorator';
import { UploadReceiptDto } from '../dtos/receipts.dto';

/** Hard multer limits: memory storage, one file, a handful of tiny text fields. */
export const UPLOAD_LIMITS = {
  fileSize: MAX_RECEIPT_BYTES,
  files: 1,
  fields: 5,
  fieldSize: 64,
  fieldNameSize: 100,
  parts: 6,
};

@Controller('receipts')
export class ReceiptsController {
  constructor(
    private readonly uploadReceipt: UploadReceipt,
    private readonly getReceiptFile: GetReceiptFile,
  ) {}

  /**
   * The client file name is never read: only the bytes and the declared part Content-Type
   * (which the use case cross-checks with the magic bytes). The guards run before multer.
   */
  @Post()
  @UploadThrottle()
  @UseInterceptors(FileInterceptor('file', { limits: UPLOAD_LIMITS }))
  upload(
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadReceiptDto,
  ): Promise<UploadReceiptOutput> {
    if (!file) throw new BadRequestException();
    return this.uploadReceipt.execute(actor, {
      file: file.buffer,
      mimeType: file.mimetype,
      paidAlone: dto.paidAlone === 'true',
    });
  }

  /** Fixed headers: the type comes from the database, the file name is generated. */
  @Get(':id/file')
  async download(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.getReceiptFile.execute(actor, id);
    res
      .status(200)
      .set({
        'Content-Type': file.mimeType,
        'Content-Length': String(file.content.length),
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `attachment; filename="${file.fileName}"`,
        'Cache-Control': 'private, no-store',
      })
      .end(file.content);
  }
}
