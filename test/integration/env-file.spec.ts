import { ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { cleanDatabase, createPrismaService } from './support/prisma-test-context';
import { testDatabaseUrl } from './support/test-database';

const ROOT = resolve(__dirname, '../..');
const FLAG = '--env-file-if-exists=.env';
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
  engines: Record<string, string>;
};

/** The real npm script command, pointed at a temporary file instead of the developer's .env. */
function scriptCommand(name: string, envFile: string): string {
  const command = pkg.scripts[name];
  expect(command).toContain(FLAG);
  return command.replace(FLAG, `--env-file-if-exists=${envFile}`);
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolvePort(port));
    });
  });
}

/** Runs with NOTHING exported but PATH: every setting must come from the file or the extras. */
function run(command: string, extra: Record<string, string> = {}): ChildProcess {
  return spawn('sh', ['-c', command], {
    cwd: ROOT,
    env: { PATH: process.env.PATH ?? '', ...extra },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function stop(child: ChildProcess): void {
  if (child.pid && child.exitCode === null) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

function collect(child: ChildProcess): { text: () => string; exited: Promise<number | null> } {
  let out = '';
  child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr?.on('data', (d: Buffer) => (out += d.toString()));
  return {
    text: () => out,
    exited: new Promise((r) => child.on('exit', (code) => r(code))),
  };
}

async function waitForHealth(port: number, child: ChildProcess): Promise<number> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('the server exited before answering');
    try {
      return (await fetch(`http://127.0.0.1:${port}/health`)).status;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error('the server never answered');
}

describe('.env loading by the npm scripts', () => {
  let dir: string;
  let envFile: string;
  const children: ChildProcess[] = [];
  const secret = randomBytes(36).toString('base64');

  const envText = (extra: Record<string, string>) =>
    Object.entries({
      DATABASE_URL: testDatabaseUrl(),
      JWT_ACCESS_SECRET: secret,
      UPLOAD_DIR: join(dir, 'uploads'),
      ...extra,
    })
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'env-file-'));
    envFile = join(dir, '.env');
  });
  afterEach(() => {
    children.splice(0).forEach(stop);
    rmSync(dir, { recursive: true, force: true });
  });

  it('declares Node >= 22.9 and every entry point reads .env without overriding the shell', () => {
    expect(pkg.engines.node).toBe('>=22.9');
    for (const name of ['start', 'start:dev', 'start:prod', 'seed']) {
      expect(pkg.scripts[name]).toContain(FLAG);
    }
    // The image gets its settings from the environment: its CMD must not depend on a file.
    const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');
    expect(dockerfile).toMatch(/^CMD \["node", "dist\/main\.js"\]$/m);
  });

  it('start:dev boots with a .env file and no exported variables', async () => {
    const port = await freePort();
    writeFileSync(envFile, envText({ PORT: String(port) }));
    const child = run(scriptCommand('start:dev', envFile));
    children.push(child);
    collect(child);
    expect(await waitForHealth(port, child)).toBe(200);
  }, 120_000);

  it('a variable already in the environment wins over the .env file', async () => {
    const [filePort, envPort] = [await freePort(), await freePort()];
    writeFileSync(envFile, envText({ PORT: String(filePort) }));
    const child = run(scriptCommand('start:dev', envFile), { PORT: String(envPort) });
    children.push(child);
    collect(child);
    expect(await waitForHealth(envPort, child)).toBe(200);
    await expect(fetch(`http://127.0.0.1:${filePort}/health`)).rejects.toThrow();
  }, 120_000);

  it('a missing .env is not an error by itself (the config check reports what is missing)', async () => {
    const child = run(scriptCommand('start:dev', join(dir, 'does-not-exist.env')));
    const output = collect(child);
    expect(await output.exited).not.toBe(0);
    expect(output.text()).toContain('Invalid environment configuration');
    expect(output.text()).not.toMatch(/not found|ENOENT/i);
  }, 120_000);

  describe('seed', () => {
    let prisma: PrismaService;
    beforeAll(() => {
      prisma = createPrismaService();
    });
    beforeEach(() => cleanDatabase(prisma));
    afterAll(() => prisma.disconnect());

    it('creates the admin from ADMIN_EMAIL and ADMIN_PASSWORD found in .env', async () => {
      writeFileSync(
        envFile,
        envText({ ADMIN_EMAIL: 'boss@example.com', ADMIN_PASSWORD: 'a long admin passphrase' }),
      );
      const child = run(scriptCommand('seed', envFile));
      children.push(child);
      const output = collect(child);
      expect(await output.exited).toBe(0);
      expect(output.text()).toContain('Admin created.');
      const admin = await prisma.client.user.findFirst({ where: { email: 'boss@example.com' } });
      expect(admin?.role).toBe('A');
    }, 120_000);
  });
});
