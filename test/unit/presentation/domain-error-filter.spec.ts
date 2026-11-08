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

  describe('body parser errors that are the client\'s doing', () => {
    function bodyError(type: string, status: number): Error {
      return Object.assign(new Error(`parser says ${type}`), { type, status });
    }

    it('treats request.aborted as a short warning, with no ERROR and no stack', () => {
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      try {
        const out = run(bodyError('request.aborted', 400));
        expect(out.status).toBe(400);
        expect(error).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith('Request aborted by the client');
      } finally {
        error.mockRestore();
        warn.mockRestore();
      }
    });

    it('does not write a response to a destroyed socket after an abort', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const json = jest.fn();
      const res = { status: () => ({ json }), socket: { destroyed: true } };
      const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
      try {
        new DomainErrorFilter().catch(bodyError('request.aborted', 400), host);
        expect(json).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it.each([
      ['request.size.invalid', 400],
      ['encoding.unsupported', 415],
      ['charset.unsupported', 415],
    ])('%s is a plain 400 and never an ERROR with a stack', (type, status) => {
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      try {
        const out = run(bodyError(type, status));
        expect(out.status).toBe(400);
        expect(JSON.stringify(out.body)).not.toContain('parser says');
        expect(error).not.toHaveBeenCalled();
      } finally {
        error.mockRestore();
      }
    });
  });
});
