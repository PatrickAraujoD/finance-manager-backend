export interface FileStorage {
  /**
   * Stores the buffer under a random name and returns the storage key.
   * `ext` has no leading dot and matches `[a-z0-9]{1,5}`; implementations must reject anything
   * else with a ValidationError.
   */
  save(buffer: Buffer, ext: string): Promise<string>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
