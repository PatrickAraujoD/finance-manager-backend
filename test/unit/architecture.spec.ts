import { ESLint } from 'eslint';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

async function lint(filePath: string, code: string) {
  const eslint = new ESLint({ cwd: process.cwd() });
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages;
}

describe('layer boundaries', () => {
  it('rejects @nestjs imports in the domain layer', async () => {
    const messages = await lint(
      'src/domain/fake.ts',
      "import { Injectable } from '@nestjs/common';\nexport const x = Injectable;\n",
    );
    expect(messages.some((m) => m.severity === 2)).toBe(true);
  });

  it('rejects @prisma/client imports in the application layer', async () => {
    const messages = await lint(
      'src/application/fake.ts',
      "import { PrismaClient } from '@prisma/client';\nexport const x = PrismaClient;\n",
    );
    expect(messages.some((m) => m.severity === 2)).toBe(true);
  });

  describe('with a real target file', () => {
    const dir = join(process.cwd(), 'src/application/__arch_tmp__');
    beforeAll(() => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'target.ts'), 'export type Target = string;\n');
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('rejects domain importing from application', async () => {
      const messages = await lint(
        'src/domain/fake.ts',
        "import type { Target } from '../application/__arch_tmp__/target';\nexport type X = Target;\n",
      );
      expect(messages.some((m) => m.severity === 2)).toBe(true);
    });
  });

  it('allows nest imports in the presentation layer', async () => {
    const messages = await lint(
      'src/presentation/http/fake.ts',
      "import { Injectable } from '@nestjs/common';\nexport const x = Injectable;\n",
    );
    expect(messages.filter((m) => m.severity === 2)).toEqual([]);
  });
});
