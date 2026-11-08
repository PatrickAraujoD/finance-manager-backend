/**
 * Runs one extractor on one file in a throw-away Node process and prints the outcome as JSON.
 * Usage: node -r ts-node/register extract-in-child.ts <image|pdf> <file>
 * Running it out of process lets a test prove the host process survives a hostile file: an
 * unhandled error in a worker would kill this child with a non-zero exit code.
 */
import { readFileSync } from 'node:fs';
import { PdfTextExtractor } from '../../../../src/infrastructure/extraction/pdf-text-extractor';
import { TesseractImageExtractor } from '../../../../src/infrastructure/extraction/tesseract-image-extractor';

const [kind, file] = process.argv.slice(2);
const extractor = kind === 'pdf' ? new PdfTextExtractor() : new TesseractImageExtractor();

extractor
  .extract(readFileSync(file), kind === 'pdf' ? 'application/pdf' : 'image/png')
  .then((result) => console.log(JSON.stringify({ cents: result.amount?.cents ?? null })))
  .catch((error: Error) => console.log(JSON.stringify({ error: error.message })));
