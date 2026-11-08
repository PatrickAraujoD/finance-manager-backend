import { FileTypeDetector } from '../../../src/application/ports/file-type-detector';

/** Tiny magic-byte sniffer so use case tests do not depend on the real library. */
export class FakeFileTypeDetector implements FileTypeDetector {
  async detect(buffer: Buffer): Promise<string | null> {
    if (buffer.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
    if (buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'image/png';
    if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
    if (buffer.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif';
    return null;
  }
}
