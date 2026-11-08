import { spawnSync } from 'child_process';
import { join } from 'path';

// Runs the commitlint CLI in a child process: @commitlint/* are ESM-only,
// which Jest cannot require without --experimental-vm-modules.
function check(message: string) {
  const bin = join(process.cwd(), 'node_modules/@commitlint/cli/cli.js');
  const run = spawnSync(process.execPath, [bin], {
    cwd: process.cwd(),
    input: message,
    encoding: 'utf8',
  });
  return { valid: run.status === 0 };
}

describe('commit convention', () => {
  it('accepts a conventional commit without scope', () => {
    const result = check('feat: add login');
    expect(result.valid).toBe(true);
  });

  it.each([
    ['non conventional header', 'Added login'],
    ['scope', 'feat(auth): add login'],
    ['uppercase type', 'FEAT: x'],
    ['capitalized subject and trailing period', 'feat: Add login.'],
    ['header longer than 72 chars', `feat: ${'a'.repeat(70)}`],
  ])('rejects %s', (_name, message) => {
    const result = check(message);
    expect(result.valid).toBe(false);
  });
});
