import { FileStorage } from '../../../src/application/ports/file-storage';
import { NotFoundError } from '../../../src/domain/errors';

export class FakeFileStorage implements FileStorage {
  private readonly files = new Map<string, Buffer>();
  private counter = 0;

  async save(buffer: Buffer, ext: string): Promise<string> {
    const key = `file-${++this.counter}${ext}`;
    this.files.set(key, buffer);
    return key;
  }
  async read(key: string): Promise<Buffer> {
    const file = this.files.get(key);
    if (!file) throw new NotFoundError('File not found');
    return file;
  }
  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }
}
