import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { findProblems } = require('../../scripts/check-secrets.js') as {
  findProblems(files: { path: string; content: string }[]): string[];
};

// Samples are assembled at runtime so this very file never looks like a leaked secret.
const awsKey = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
const pem = ['-----BEGIN ', 'RSA PRIVATE KEY-----'].join('');
const ghToken = ['ghp', '_', 'a'.repeat(36)].join('');
const dbUrl = ['postgresql://app', ':', 'Zq8v2LmP9xKd', '@db.prod:5432/app'].join('');
const jwtLike = ['eyJ', 'a'.repeat(20), '.eyJ', 'b'.repeat(20), '.', 'c'.repeat(20)].join('');

describe('secrets check', () => {
  it('flags env files other than .env.example', () => {
    for (const path of ['.env', '.env.local', 'config/.env.production', 'x/prod.env']) {
      expect(findProblems([{ path, content: '' }])).not.toEqual([]);
    }
    expect(findProblems([{ path: '.env.example', content: 'A=\n' }])).toEqual([]);
  });

  it.each([
    ['an AWS access key', `key = ${awsKey}`],
    ['a private key block', `${pem}\nMIIB`],
    ['a GitHub token', `token: ${ghToken}`],
    ['a JWT', `Authorization: Bearer ${jwtLike}`],
    ['a database URL with a real password', `DATABASE_URL=${dbUrl}`],
  ])('flags %s in a tracked file', (_name, content) => {
    expect(findProblems([{ path: 'src/x.ts', content }])).toHaveLength(1);
  });

  it('accepts the documented local development credentials and plain code', () => {
    const content = 'DATABASE_URL=postgresql://finance:finance@localhost:5432/finance\nconst a = 1;';
    expect(findProblems([{ path: 'README.md', content }])).toEqual([]);
  });

  it('finds nothing in the files tracked by git right now', () => {
    const run = spawnSync(process.execPath, [join(process.cwd(), 'scripts/check-secrets.js')], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(run.stdout + run.stderr).toMatch(/no secrets found/i);
    expect(run.status).toBe(0);
  });
});
