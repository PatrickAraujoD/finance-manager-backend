import { ArgumentsHost, Logger } from '@nestjs/common';
import { MulterError } from 'multer';
import { StoredFileMissingError } from '../../../src/domain/errors';
import { DomainErrorFilter } from '../../../src/presentation/http/filters/domain-error.filter';

function run(error: unknown): { status: number; body: unknown } {
  let out = { status: 0, body: undefined as unknown };
  const res = {
    status(code: number) {
      out.status = code;
      return { json: (b: unknown) => void (out = { status: code, body: b }) };
    },
  };
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
  new DomainErrorFilter().catch(error, host);
  return out;
}

describe('DomainErrorFilter and multer errors', () => {
  it('maps LIMIT_FILE_SIZE to a generic 413', () => {
    expect(run(new MulterError('LIMIT_FILE_SIZE', 'file'))).toEqual({
      status: 413,
      body: { statusCode: 413, error: 'Payload Too Large', message: 'Payload Too Large' },
    });
  });

  it.each([
    'LIMIT_FILE_COUNT',
    'LIMIT_UNEXPECTED_FILE',
    'LIMIT_FIELD_COUNT',
    'LIMIT_FIELD_KEY',
    'LIMIT_FIELD_VALUE',
    'LIMIT_PART_COUNT',
  ] as const)('maps %s to a generic 400 that never echoes the field name', (code) => {
    const out = run(new MulterError(code, 'secret-field-name'));
    expect(out.status).toBe(400);
    expect(JSON.stringify(out.body)).not.toContain('secret-field-name');
  });

  it('logs a missing stored file internally but answers a plain 404', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const out = run(new StoredFileMissingError('Stored file of receipt r1 is missing'));
      expect(out).toEqual({
        status: 404,
        body: { statusCode: 404, error: 'Not Found', message: 'Not Found' },
      });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('r1'));
    } finally {
      warn.mockRestore();
    }
  });
});
