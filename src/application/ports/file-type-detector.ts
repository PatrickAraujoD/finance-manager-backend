export interface FileTypeDetector {
  /** Real mime type from the file's magic bytes, or null when it is not recognised. */
  detect(buffer: Buffer): Promise<string | null>;
}
