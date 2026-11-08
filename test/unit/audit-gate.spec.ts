import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

type RunResult = { stdout?: string; stderr?: string; status?: number | null; error?: Error };
type GateResult = { code: number; stdout: string[]; stderr: string[] };

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runGate } = require('../../scripts/audit-gate.js') as {
  runGate(opts: { run: () => RunResult; today?: string }): GateResult;
};

const TODAY = '2026-12-01';

function report(vulnerabilities: Record<string, unknown> = {}): string {
  return JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities,
    metadata: { vulnerabilities: { total: Object.keys(vulnerabilities).length } },
  });
}

function vuln(source: number, severity = 'high'): Record<string, unknown> {
  return {
    name: 'some-pkg',
    severity,
    via: [{ source, name: 'some-pkg', title: 'bad', url: 'https://x.test/a', severity }],
  };
}

const gate = (stdout: string, extra: Partial<RunResult> = {}, today = TODAY): GateResult =>
  runGate({ run: () => ({ stdout, stderr: '', status: 0, ...extra }), today });

describe('audit gate', () => {
  it('passes a well-formed report with no vulnerabilities', () => {
    const r = gate(report());
    expect(r.code).toBe(0);
    expect(r.stdout.join('\n')).toMatch(/audit gate ok/);
  });

  it('passes when only accepted advisories are present, even if npm audit exits 1', () => {
    const r = gate(report({ 'image-size': vuln(1239765) }), { status: 1 });
    expect(r.code).toBe(0);
  });

  it('passes low and moderate advisories that are not accepted', () => {
    expect(gate(report({ a: vuln(42, 'moderate') })).code).toBe(0);
  });

  it('fails on a new high advisory', () => {
    const r = gate(report({ a: vuln(999999999) }));
    expect(r.code).toBe(1);
    expect(r.stderr.join('\n')).toMatch(/NOVO/);
  });

  it('fails on a new critical advisory', () => {
    expect(gate(report({ a: vuln(999999998, 'critical') })).code).toBe(1);
  });

  it('fails when an acceptance has expired', () => {
    const r = gate(report({ 'image-size': vuln(1239765) }), {}, '2027-02-09');
    expect(r.code).toBe(1);
    expect(r.stderr.join('\n')).toMatch(/venceu/);
  });

  it.each([
    ['empty object', '{}'],
    ['array', '[]'],
    ['null', 'null'],
    ['a number', '1'],
    ['vulnerabilities null', '{"vulnerabilities":null}'],
    ['vulnerabilities array', '{"auditReportVersion":2,"vulnerabilities":[],"metadata":{"vulnerabilities":{}}}'],
    ['no metadata', '{"auditReportVersion":2,"vulnerabilities":{}}'],
    ['metadata.vulnerabilities null', '{"auditReportVersion":2,"vulnerabilities":{},"metadata":{"vulnerabilities":null}}'],
    ['no auditReportVersion', '{"vulnerabilities":{},"metadata":{"vulnerabilities":{}}}'],
    ['string auditReportVersion', '{"auditReportVersion":"2","vulnerabilities":{},"metadata":{"vulnerabilities":{}}}'],
    ['vulnerability without via', '{"auditReportVersion":2,"vulnerabilities":{"a":{"name":"a"}},"metadata":{"vulnerabilities":{}}}'],
    ['non-JSON text', 'Service Unavailable'],
    ['empty output', ''],
    ['whitespace output', '  \n'],
  ])('fails closed on %s', (_n, stdout) => {
    const r = gate(stdout);
    expect(r.code).not.toBe(0);
    expect(r.stdout.join('\n')).not.toMatch(/audit gate ok/);
    expect(r.stderr.join('\n')).toMatch(/FALHA/);
  });

  it('fails when npm audit reports an error object (network)', () => {
    const err = JSON.stringify({ error: { code: 'ENOTFOUND', summary: 'request failed' } });
    const r = gate(err, { status: 1 });
    expect(r.code).not.toBe(0);
    expect(r.stderr.join('\n')).toMatch(/ENOTFOUND|request failed/);
  });

  it('fails when the process cannot be spawned or errors out', () => {
    expect(runGate({ run: () => ({ error: new Error('spawn npm ENOENT') }), today: TODAY }).code).not.toBe(0);
    expect(gate('', { stderr: 'npm ERR! network', status: 1 }).code).not.toBe(0);
  });

  it('exits non-zero from the CLI on an invalid --input file', () => {
    const run = spawnSync(
      process.execPath,
      [join(process.cwd(), 'scripts/audit-gate.js'), '--input', '/nonexistent/audit.json'],
      { encoding: 'utf8' },
    );
    expect(run.status).not.toBe(0);
  });
});
