import { Module } from '@nestjs/common';
import { FileStorage } from '../../../application/ports/file-storage';
import { FileTypeDetector } from '../../../application/ports/file-type-detector';
import { IdGenerator } from '../../../application/ports/id-generator';
import { ReceiptExtractor } from '../../../application/ports/receipt-extractor';
import { ReceiptRepository } from '../../../application/ports/receipt-repository';
import { GetReceiptFile } from '../../../application/use-cases/receipts/get-receipt-file';
import { UploadReceipt } from '../../../application/use-cases/receipts/upload-receipt';
import { CompositeReceiptExtractor } from '../../../infrastructure/extraction/composite-receipt-extractor';
import { MagicBytesFileTypeDetector } from '../../../infrastructure/extraction/file-type-detector';
import { PdfTextExtractor } from '../../../infrastructure/extraction/pdf-text-extractor';
import { TesseractImageExtractor } from '../../../infrastructure/extraction/tesseract-image-extractor';
import { LocalFileStorage } from '../../../infrastructure/storage/local-file-storage';
import { AppConfig } from '../config';
import { ReceiptsController } from '../controllers/receipts.controller';
import {
  APP_CONFIG,
  FILE_STORAGE,
  FILE_TYPE_DETECTOR,
  ID_GENERATOR,
  RECEIPT_EXTRACTOR,
  RECEIPT_REPOSITORY,
} from '../tokens';

let sharedExtractor: ReceiptExtractor | undefined;

/**
 * One extractor per process: the PDF and OCR concurrency limits live inside it, so every app
 * (and every request) in this process shares the same counters.
 */
function processExtractor(): ReceiptExtractor {
  sharedExtractor ??= new CompositeReceiptExtractor(
    new PdfTextExtractor(),
    new TesseractImageExtractor(),
  );
  return sharedExtractor;
}

@Module({
  controllers: [ReceiptsController],
  providers: [
    {
      provide: FILE_STORAGE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new LocalFileStorage(config.uploadDir),
    },
    { provide: FILE_TYPE_DETECTOR, useFactory: () => new MagicBytesFileTypeDetector() },
    { provide: RECEIPT_EXTRACTOR, useFactory: processExtractor },
    {
      provide: UploadReceipt,
      inject: [FILE_STORAGE, RECEIPT_REPOSITORY, RECEIPT_EXTRACTOR, FILE_TYPE_DETECTOR, ID_GENERATOR],
      useFactory: (
        storage: FileStorage,
        receipts: ReceiptRepository,
        extractor: ReceiptExtractor,
        fileTypes: FileTypeDetector,
        ids: IdGenerator,
      ) => new UploadReceipt(storage, receipts, extractor, fileTypes, ids),
    },
    {
      provide: GetReceiptFile,
      inject: [RECEIPT_REPOSITORY, FILE_STORAGE],
      useFactory: (receipts: ReceiptRepository, storage: FileStorage) =>
        new GetReceiptFile(receipts, storage),
    },
  ],
})
export class ReceiptsModule {}
