import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { FileTypeLibDetector } from '../../../src/infrastructure/extraction/file-type-detector';

const fixture = (name: string) => readFileSync(join(__dirname, '..', '..', 'fixtures', name));

describe('FileTypeLibDetector (magic bytes)', () => {
  const detector = new FileTypeLibDetector();

  it('detects PDF, PNG and JPEG', async () => {
    expect(await detector.detect(fixture('comprovante-texto.pdf'))).toBe('application/pdf');
    expect(await detector.detect(fixture('comprovante.png'))).toBe('image/png');
    const jpeg = createCanvas(10, 10).toBuffer('image/jpeg');
    expect(await detector.detect(jpeg)).toBe('image/jpeg');
  });

  it('ignores the file name: a PNG named .pdf is a PNG', async () => {
    expect(await detector.detect(fixture('falso.pdf'))).toBe('image/png');
  });

  it('reports other known types as what they are', async () => {
    const gif = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1');
    expect(await detector.detect(gif)).toBe('image/gif');
  });

  it('returns null for text, empty and random bytes', async () => {
    expect(await detector.detect(Buffer.from('just some text'))).toBeNull();
    expect(await detector.detect(Buffer.alloc(0))).toBeNull();
    expect(await detector.detect(Buffer.alloc(64, 0xab))).toBeNull();
  });
});
