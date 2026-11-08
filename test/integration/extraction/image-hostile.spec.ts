import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { extractInChild } from './support/run-in-child';

const fixture = (name: string) => readFileSync(join(__dirname, '..', '..', 'fixtures', name));

function ihdr(width: number, height: number): Buffer {
  const buf = Buffer.from(fixture('comprovante.png').subarray(0, 33));
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

describe('image extraction survives hostile images (out of process)', () => {
  jest.setTimeout(120_000);
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'fm-hostile-img-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const jpeg = () => {
    const canvas = createCanvas(300, 100);
    canvas.getContext('2d').fillRect(0, 0, 300, 100);
    return canvas.toBuffer('image/jpeg');
  };
  const png = fixture('comprovante.png');

  it.each([
    ['valid IHDR followed by garbage (40 bytes)', () => Buffer.concat([ihdr(600, 160), Buffer.from('garbage')])],
    ['PNG truncated in the middle', () => png.subarray(0, Math.floor(png.length / 2))],
    ['PNG truncated right after IHDR', () => png.subarray(0, 45)],
    ['IHDR 10x10 over the data of a bigger image', () => Buffer.concat([ihdr(10, 10), png.subarray(33)])],
    ['JPEG truncated', () => jpeg().subarray(0, 60)],
    ['JPEG with its tail replaced by noise', () => Buffer.concat([jpeg().subarray(0, 120), Buffer.alloc(200, 0xab)])],
  ])('%s -> null and the process stays alive', async (name, make) => {
    const file = join(dir, `${name.replace(/\W+/g, '-')}.bin`);
    writeFileSync(file, make());
    const outcome = await extractInChild('image', file);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.result).toEqual({ cents: null });
  });
});
