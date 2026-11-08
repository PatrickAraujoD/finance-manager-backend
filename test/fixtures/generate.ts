/**
 * Regenerates the receipt fixtures used by the extraction tests: `npm run fixtures`.
 * The generated files are committed (they are tiny); the generator is dev-only.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const OUT = __dirname;

async function textPdf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 300]);
  lines.forEach((line, i) => page.drawText(line, { x: 30, y: 250 - i * 30, size: 14, font }));
  return Buffer.from(await doc.save());
}

async function pdfWithoutText(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  page.drawRectangle({ x: 30, y: 100, width: 200, height: 60, color: rgb(0.2, 0.2, 0.2) });
  return Buffer.from(await doc.save());
}

function textPng(text: string): Buffer {
  const canvas = createCanvas(600, 160);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 600, 160);
  ctx.fillStyle = '#000000';
  ctx.font = '40px sans-serif';
  ctx.fillText(text, 30, 95);
  return canvas.toBuffer('image/png');
}

/** Deterministic pseudo-random bytes (LCG), so regenerating does not change the file. */
function garbagePdf(): Buffer {
  const bytes = Buffer.alloc(2048);
  let seed = 12345;
  for (let i = 0; i < bytes.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    bytes[i] = seed >> 16;
  }
  return Buffer.concat([Buffer.from('%PDF-1.4\n'), bytes]);
}

async function main(): Promise<void> {
  const png = textPng('Valor R$ 123,45');
  const files: Record<string, Buffer> = {
    'comprovante-texto.pdf': await textPdf(['Comprovante de pagamento', 'Valor: R$ 123,45']),
    'comprovante-varios-valores.pdf': await textPdf([
      'Extrato',
      'Saldo R$ 1.000,00',
      'Tarifa R$ 2,50',
    ]),
    'comprovante.png': png,
    'sem-texto.pdf': await pdfWithoutText(),
    'lixo.pdf': garbagePdf(),
    'falso.pdf': png,
  };
  for (const [name, content] of Object.entries(files)) writeFileSync(join(OUT, name), content);
}

void main();
