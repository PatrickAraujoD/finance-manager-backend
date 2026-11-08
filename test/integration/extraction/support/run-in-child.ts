import { spawn } from 'node:child_process';
import { join } from 'node:path';

export interface ChildOutcome {
  exitCode: number | null;
  /** The JSON line the child printed, when it got that far. */
  result: { cents?: number | null; error?: string } | null;
}

/** Extracts `file` in a separate process; resolves with how that process ended. */
export function extractInChild(kind: 'image' | 'pdf', file: string): Promise<ChildOutcome> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['-r', 'ts-node/register/transpile-only', join(__dirname, 'extract-in-child.ts'), kind, file],
      {
        stdio: ['ignore', 'pipe', 'ignore'],
        // ts-node under TypeScript 6 needs an explicit rootDir for a script outside src/.
        env: {
          ...process.env,
          TS_NODE_COMPILER_OPTIONS: JSON.stringify({ rootDir: join(__dirname, '..', '..', '..', '..') }),
        },
      },
    );
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk));
    child.on('close', (exitCode) => {
      let result: ChildOutcome['result'] = null;
      try {
        result = JSON.parse(out.trim().split('\n').pop() ?? '');
      } catch {
        // the child died before printing
      }
      resolve({ exitCode, result });
    });
  });
}
