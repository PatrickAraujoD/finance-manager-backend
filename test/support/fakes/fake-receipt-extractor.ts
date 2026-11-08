import {
  ExtractionResult,
  ReceiptExtractor,
} from '../../../src/application/ports/receipt-extractor';

export class FakeReceiptExtractor implements ReceiptExtractor {
  readonly calls: { buffer: Buffer; mimeType: string }[] = [];

  constructor(public result: ExtractionResult = { amount: null, confidence: 0 }) {}

  async extract(buffer: Buffer, mimeType: string): Promise<ExtractionResult> {
    this.calls.push({ buffer, mimeType });
    return this.result;
  }
}
