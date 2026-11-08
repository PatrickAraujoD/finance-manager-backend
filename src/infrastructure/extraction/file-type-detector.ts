import { fromBuffer } from 'file-type';
import { FileTypeDetector } from '../../application/ports/file-type-detector';

export class FileTypeLibDetector implements FileTypeDetector {
  async detect(buffer: Buffer): Promise<string | null> {
    if (buffer.length === 0) return null;
    return (await fromBuffer(buffer))?.mime ?? null;
  }
}
