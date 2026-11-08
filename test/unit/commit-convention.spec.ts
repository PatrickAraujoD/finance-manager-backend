import lint from '@commitlint/lint';
import load from '@commitlint/load';

async function check(message: string) {
  const config = await load({}, { cwd: process.cwd() });
  return lint(message, config.rules, {
    parserOpts: config.parserPreset?.parserOpts,
  });
}

describe('commit convention', () => {
  it('accepts a conventional commit without scope', async () => {
    const result = await check('feat: add login');
    expect(result.valid).toBe(true);
  });

  it.each([
    ['non conventional header', 'Added login'],
    ['scope', 'feat(auth): add login'],
    ['uppercase type', 'FEAT: x'],
    ['capitalized subject and trailing period', 'feat: Add login.'],
    ['header longer than 72 chars', `feat: ${'a'.repeat(70)}`],
  ])('rejects %s', async (_name, message) => {
    const result = await check(message);
    expect(result.valid).toBe(false);
  });
});
