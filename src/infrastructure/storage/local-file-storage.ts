import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FileStorage } from '../../application/ports/file-storage';
import { NotFoundError, ValidationError } from '../../domain/errors';

const EXT_PATTERN = /^[a-z0-9]{1,5}$/;
// The only shape of key this class ever generates; anything else never touches the disk.
const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,5}$/;

function requireKey(key: string): void {
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
    throw new ValidationError('Invalid storage key');
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

/** Stores uploads as private files in a single directory. */
export class LocalFileStorage implements FileStorage {
  constructor(private readonly dir: string) {}

  async save(buffer: Buffer, ext: string): Promise<string> {
    if (typeof ext !== 'string' || !EXT_PATTERN.test(ext)) {
      throw new ValidationError('Invalid file extension');
    }
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const key = `${randomUUID()}.${ext}`;
    // 'wx': fails instead of overwriting, so a (practically impossible) collision cannot
    // clobber another user's receipt.
    await writeFile(join(this.dir, key), buffer, { flag: 'wx', mode: 0o600 });
    return key;
  }

  async read(key: string): Promise<Buffer> {
    requireKey(key);
    let handle;
    try {
      // O_NOFOLLOW: a symlink planted in the directory is refused, not followed.
      handle = await open(join(this.dir, key), constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') throw new NotFoundError('File not found');
      if (errorCode(error) === 'ELOOP') throw new ValidationError('Invalid storage key');
      throw error;
    }
    try {
      if (!(await handle.stat()).isFile()) throw new ValidationError('Invalid storage key');
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  }

  async delete(key: string): Promise<void> {
    requireKey(key);
    try {
      // unlink removes a symlink itself, never its target.
      await unlink(join(this.dir, key));
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
    }
  }
}
