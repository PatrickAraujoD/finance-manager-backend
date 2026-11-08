import { FileTypeDetector } from '../../application/ports/file-type-detector';

const PDF = Buffer.from('%PDF-', 'latin1');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);

function startsWith(buffer: Buffer, signature: Buffer): boolean {
  return buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature);
}

/**
 * Recognises exactly the three accepted types from their signature at offset 0. It compares a
 * handful of bytes: it never parses the container, so no input can make it throw or spin (the
 * general-purpose file-type library did both on malformed ASF/TIFF files).
 */
export class FileTypeLibDetector implements FileTypeDetector {
  async detect(buffer: Buffer): Promise<string | null> {
    if (startsWith(buffer, PDF)) return 'application/pdf';
    if (startsWith(buffer, PNG)) return 'image/png';
    if (startsWith(buffer, JPEG)) return 'image/jpeg';
    return null;
  }
}
