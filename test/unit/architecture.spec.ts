import { ESLint } from 'eslint';

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

  it('rejects domain importing from application', async () => {
    const messages = await lint(
      'src/domain/fake.ts',
      "import { Clock } from '../application/ports/clock';\nexport type X = Clock;\n",
    );
    expect(messages.some((m) => m.severity === 2)).toBe(true);
  });

  it('allows nest imports in the presentation layer', async () => {
    const messages = await lint(
      'src/presentation/http/fake.ts',
      "import { Injectable } from '@nestjs/common';\nexport const x = Injectable;\n",
    );
    expect(messages.filter((m) => m.severity === 2)).toEqual([]);
  });
});
