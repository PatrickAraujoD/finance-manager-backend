import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { findProblems, scan } = require('../../scripts/check-secrets.js') as {
  findProblems(files: ScanFile[]): string[];
  scan(files: ScanFile[]): { problems: string[]; warnings: string[] };
};

type ScanFile = { path: string; content: string; skipped?: 'binary' | 'too large' };

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

const rand24 = ['kJ3x9Qm2', 'Zp7LvT4b', 'Nw8RdYc5'].join('');
const hex64 = ['a3f9c2e1b7d4086f', '5a2c9e1d3b7f4a60', 'c8e2d1f5b9a3c7e4', 'd6f80a1b2c3d4e5f'].join('');
const b64 = ['q7Vn2KxR9mZ4tLb8', 'Wc3YdH6jPf1sGu5E', 'oAi0NvX7TyBr4QkM'].join('');
const stripe = ['sk', '_live_', '4eC39HqLyjWDarjtT1zdp7dc'].join('');
const stripeRk = ['rk', '_live_', '51HxYzAbCdEfGhIjKlMnOpQr'].join('');
const ghPat = ['github', '_pat_', '11ABCDEFG0abcdefghij_Kl3mNoPqRs'].join('');
const gho = ['gho', '_', 'Ab3'.repeat(12)].join('');
const ghs = ['ghs', '_', 'Xy9'.repeat(12)].join('');
const google = ['AI', 'za', 'SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'].join('');
const slack = ['xox', 'b-', '123456789012-abcdefABCDEF'].join('');

describe('secrets check: assignments in any tracked file', () => {
  it.each([
    ['JWT_ACCESS_SECRET in code', 'src/x.ts', `const x = { JWT_ACCESS_SECRET: '${rand24}' };`],
    ['JWT_ACCESS_SECRET in env style', 'README.md', `JWT_ACCESS_SECRET=${rand24}`],
    ['*_SECRET in compose', 'docker-compose.yml', `      - APP_SECRET=${rand24}`],
    ['*_PASSWORD in a script', 'scripts/x.sh', `export DB_PASSWORD="${rand24}"`],
    ['*_TOKEN', 'ci.txt', `SERVICE_TOKEN=${rand24}`],
    ['API_KEY', 'docs/x.md', `API_KEY=${rand24}`],
    ['password in yaml', 'config/app.yml', `password: ${rand24}`],
    ['api_key in json', 'config/app.json', `{"api_key": "${rand24}"}`],
    ['export in .envrc content', 'scripts/setup.sh', `export JWT_ACCESS_SECRET=${rand24}`],
  ])('flags %s', (_n, path, content) => {
    expect(findProblems([{ path, content }])).toHaveLength(1);
  });

  it('ignores placeholders, references and short or low-entropy values', () => {
    const lines = [
      'JWT_ACCESS_SECRET=troque-por-um-segredo-gerado-com-openssl-rand-base64-48',
      'JWT_ACCESS_SECRET=',
      'JWT_ACCESS_SECRET=${secret}',
      'secret="$(openssl rand -base64 48)"',
      'password: string;',
      'const token = process.env.JWT_ACCESS_SECRET;',
      'ADMIN_PASSWORD=changeme',
      `API_KEY=${'a'.repeat(32)}`,
      'password: <your-password-here>',
      'passwordHash: await this.hasher.hash(password)',
    ];
    for (const l of lines) expect(findProblems([{ path: 'src/y.ts', content: l }])).toEqual([]);
  });

  it('requires .env.example to hold only empty values or obvious placeholders', () => {
    const ok = 'JWT_ACCESS_SECRET=\nADMIN_PASSWORD=\nX_SECRET=troque-por-um-segredo-gerado\n';
    expect(findProblems([{ path: '.env.example', content: ok }])).toEqual([]);
    const bad = `JWT_ACCESS_SECRET=${rand24}\n`;
    const problems = findProblems([{ path: '.env.example', content: bad }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/\.env\.example/);
  });

  it('flags a .envrc file like any other env file', () => {
    expect(findProblems([{ path: '.envrc', content: '' }])).not.toEqual([]);
    expect(findProblems([{ path: 'sub/.envrc', content: '' }])).not.toEqual([]);
  });
});

describe('secrets check: vendor token formats', () => {
  it.each([
    ['a Stripe live secret key', stripe],
    ['a Stripe restricted live key', stripeRk],
    ['a GitHub fine-grained token', ghPat],
    ['a GitHub OAuth token', gho],
    ['a GitHub server token', ghs],
    ['a Google API key', google],
    ['a Slack token', slack],
  ])('flags %s', (_n, token) => {
    expect(findProblems([{ path: 'src/x.ts', content: `v = "${token}"` }])).not.toEqual([]);
  });
});

describe('secrets check: long high-entropy strings', () => {
  it('flags long hex and base64 keys', () => {
    expect(findProblems([{ path: 'src/x.ts', content: `k = '${hex64}'` }])).toHaveLength(1);
    expect(findProblems([{ path: 'src/x.ts', content: `k = '${b64}'` }])).toHaveLength(1);
  });

  it('does not flag lockfile integrity hashes, commit hashes, action pins or fixtures', () => {
    const integrity = `"integrity": "sha512-${b64}${b64.slice(0, 20)}=="`;
    expect(findProblems([{ path: 'package-lock.json', content: integrity }])).toEqual([]);
    expect(findProblems([{ path: 'x/other.json', content: integrity }])).toEqual([]);
    const lock = `"resolved": "https://registry.npmjs.org/a/-/a.tgz#${hex64.slice(0, 40)}"`;
    expect(findProblems([{ path: 'package-lock.json', content: lock }])).toEqual([]);
    const commit = `Fixed in commit ${hex64.slice(0, 40)} on main`;
    expect(findProblems([{ path: 'docs/status.md', content: commit }])).toEqual([]);
    const pin = `      - uses: actions/checkout@${hex64.slice(0, 40)} # v6`;
    expect(findProblems([{ path: '.github/workflows/ci.yml', content: pin }])).toEqual([]);
    expect(findProblems([{ path: 'test/fixtures/blob.txt', content: b64 }])).toEqual([]);
  });

  it('does not flag long plain identifiers, paths or repeated characters', () => {
    const lines = [
      `const ${'createCategoryAndReturnTheNewlyCreatedResponseObject'} = 1;`,
      '/Users/patrickaraujo/Documents/projetos/finance-manager-backend/src/main.ts',
      '0'.repeat(40),
      'a'.repeat(64),
    ];
    for (const l of lines) expect(findProblems([{ path: 'docs/x.md', content: l }])).toEqual([]);
  });
});

describe('secrets check: skipped files', () => {
  it('warns about skipped binary files but passes', () => {
    const r = scan([{ path: 'test/fixtures/a.png', content: '', skipped: 'binary' }]);
    expect(r.problems).toEqual([]);
    expect(r.warnings.join('\n')).toMatch(/a\.png.*binary/);
  });

  it('fails when a known text config file could not be scanned', () => {
    for (const path of ['config/app.json', 'docker-compose.yml', 'x/.npmrc', 'deploy/app.toml', 'Dockerfile']) {
      const r = scan([{ path, content: '', skipped: 'too large' }]);
      expect(r.problems.join('\n')).toMatch(/not scanned/);
    }
    expect(scan([{ path: 'a/b.json', content: '', skipped: 'binary' }]).problems).not.toEqual([]);
  });

  it('keeps findProblems returning only problems', () => {
    expect(findProblems([{ path: 'img.png', content: '', skipped: 'binary' }])).toEqual([]);
  });
});
