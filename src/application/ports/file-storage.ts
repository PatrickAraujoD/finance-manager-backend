export interface FileStorage {
  /** Stores the buffer under a random name and returns the storage key. */
  save(buffer: Buffer, ext: string): Promise<string>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
