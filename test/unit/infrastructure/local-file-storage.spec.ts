import { existsSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotFoundError, ValidationError } from '../../../src/domain/errors';
import { LocalFileStorage } from '../../../src/infrastructure/storage/local-file-storage';

describe('LocalFileStorage', () => {
  let root: string;
  let dir: string;
  let storage: LocalFileStorage;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fm-storage-'));
    dir = join(root, 'uploads');
    storage = new LocalFileStorage(dir);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  describe('save', () => {
    it('stores under <uuid>.<ext> and reads it back', async () => {
      const key = await storage.save(Buffer.from('hello'), 'pdf');
      expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/);
      expect((await storage.read(key)).toString()).toBe('hello');
    });

    it('creates the directory as 0700 and the file as 0600', async () => {
      const key = await storage.save(Buffer.from('x'), 'png');
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(statSync(join(dir, key)).mode & 0o777).toBe(0o600);
    });

    it('never reuses a key', async () => {
      const keys = await Promise.all([1, 2, 3, 4, 5].map(() => storage.save(Buffer.from('x'), 'pdf')));
      expect(new Set(keys).size).toBe(5);
    });

    it.each(['', 'PDF', '../x', 'a.b', 'toolong', 'p/f', 'p\0f', ' pdf', 'pdf\n'])(
      'rejects the extension %j',
      async (ext) => {
        await expect(storage.save(Buffer.from('x'), ext)).rejects.toThrow(ValidationError);
      },
    );
  });

  describe('read', () => {
    it.each([
      '../../etc/passwd',
      '..%2f..%2fetc%2fpasswd',
      '%2e%2e/%2e%2e/etc/passwd',
      '/etc/passwd',
      'a\0b.pdf',
      '',
      '.',
      '..',
      'secret.pdf',
      '00000000-0000-0000-0000-000000000000.pdf/../../x',
      '00000000-0000-0000-0000-000000000000.pdf\n',
    ])('rejects the hostile key %j', async (key) => {
      await expect(storage.read(key)).rejects.toThrow(ValidationError);
    });

    it('does not read a file outside the directory even when it exists', async () => {
      await storage.save(Buffer.from('x'), 'pdf');
      writeFileSync(join(root, 'outside.txt'), 'top secret');
      await expect(storage.read('../outside.txt')).rejects.toThrow(ValidationError);
    });

    it('refuses a symlink inside the directory that points outside', async () => {
      await storage.save(Buffer.from('x'), 'pdf');
      writeFileSync(join(root, 'outside.txt'), 'top secret');
      const key = '11111111-1111-1111-1111-111111111111.pdf';
      symlinkSync(join(root, 'outside.txt'), join(dir, key));
      await expect(storage.read(key)).rejects.toThrow(ValidationError);
    });

    it('reports a missing file as NotFoundError', async () => {
      await storage.save(Buffer.from('x'), 'pdf');
      await expect(storage.read('22222222-2222-2222-2222-222222222222.pdf')).rejects.toThrow(
        NotFoundError,
      );
    });

    it('reports a missing directory as NotFoundError', async () => {
      await expect(storage.read('22222222-2222-2222-2222-222222222222.pdf')).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe('delete', () => {
    it('removes the file and is idempotent', async () => {
      const key = await storage.save(Buffer.from('x'), 'pdf');
      await storage.delete(key);
      expect(existsSync(join(dir, key))).toBe(false);
      await expect(storage.delete(key)).resolves.toBeUndefined();
    });

    it('rejects hostile keys and leaves outside files alone', async () => {
      await storage.save(Buffer.from('x'), 'pdf');
      writeFileSync(join(root, 'outside.txt'), 'keep me');
      await expect(storage.delete('../outside.txt')).rejects.toThrow(ValidationError);
      await expect(storage.delete('/etc/passwd')).rejects.toThrow(ValidationError);
      expect(existsSync(join(root, 'outside.txt'))).toBe(true);
    });

    it('removes only the symlink, never its target', async () => {
      await storage.save(Buffer.from('x'), 'pdf');
      writeFileSync(join(root, 'outside.txt'), 'keep me');
      const key = '11111111-1111-1111-1111-111111111111.pdf';
      symlinkSync(join(root, 'outside.txt'), join(dir, key));
      await storage.delete(key);
      expect(existsSync(join(root, 'outside.txt'))).toBe(true);
    });
  });
});
