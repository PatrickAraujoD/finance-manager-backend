#!/usr/bin/env node
'use strict';

/**
 * Gate de `npm audit` com lista explicita de riscos aceitos.
 *
 * Por que existe: `npm audit --audit-level=high` falha com QUALQUER advisory alto, inclusive os
 * que ja analisamos e decidimos aceitar. Silenciar tudo (ou ignorar o resultado) esconderia
 * advisories NOVOS. Aqui o pipeline falha somente quando aparece um advisory (severidade >= high)
 * que NAO esta em ACCEPTED_ADVISORIES, ou quando uma aceitacao venceu (expires).
 *
 * Falha FECHADO: JSON vazio, invalido, sem `auditReportVersion` numerico, sem
 * `metadata.vulnerabilities` ou sem `vulnerabilities` (objeto), erro do npm (rede, registry) ou
 * qualquer forma inesperada resulta em codigo != 0. "Sem resposta" nunca significa "sem problemas".
 *
 * Uso:
 *   node scripts/audit-gate.js                 # roda `npm audit --omit=dev --json`
 *   node scripts/audit-gate.js --input a.json  # le um JSON ja gerado (para testar o gate)
 *
 * Para aceitar um novo risco: adicione uma entrada abaixo COM motivo, data e prazo, e registre
 * em docs/pipeline-status.md. Nunca adicione sem analise.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

const BLOCKING = new Set(['high', 'critical']);

/** Chave = id numerico do advisory no npm audit (campo `source`). */
const ACCEPTED_ADVISORIES = {
  1239765: {
    ghsa: 'GHSA-5p2g-fcmc-qvqq',
    pkg: 'image-size',
    acceptedAt: '2026-11-08',
    expires: '2027-02-08',
    reason:
      'JXL/HEIF causam loop infinito no parser, mas so aceitamos PDF/PNG/JPEG (magic bytes) e ' +
      'image-size le apenas o cabecalho de PNG/JPEG: o codigo vulneravel e inalcancavel. ' +
      'Corrigir exige major (2.x).',
  },
  1239766: {
    ghsa: 'GHSA-w3rx-r6r6-pgpr',
    pkg: 'image-size',
    acceptedAt: '2026-11-08',
    expires: '2027-02-08',
    reason: 'ICNS: mesmo raciocinio do advisory acima; formato nunca chega ao parser.',
  },
  1145093: {
    ghsa: 'GHSA-ggr8-5vv4-36mx',
    pkg: 'deepmerge-ts (via @prisma/config, prisma CLI)',
    acceptedAt: '2026-11-08',
    expires: '2027-02-08',
    reason:
      'Esgotamento de pilha ao mesclar grafos recursivos, usado so pelo prisma CLI em ' +
      'build/migrate com configuracao nossa (nunca entrada do usuario). Nao roda no servidor. ' +
      'Corrigir exige prisma 7 (major).',
  },
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Converte a saida do npm audit em objeto, ou lanca Error com mensagem clara. */
function parseAudit(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('saida vazia do npm audit');
  }
  let audit;
  try {
    audit = JSON.parse(text);
  } catch {
    throw new Error(`saida do npm audit nao e JSON: ${text.trim().slice(0, 200)}`);
  }
  if (!isObject(audit)) throw new Error('JSON do npm audit nao e um objeto');
  if (audit.error) {
    const e = audit.error;
    throw new Error(`npm audit falhou: ${e.code || ''} ${e.summary || JSON.stringify(e)}`.trim());
  }
  if (typeof audit.auditReportVersion !== 'number') {
    throw new Error('relatorio sem auditReportVersion numerico (formato inesperado)');
  }
  if (!isObject(audit.metadata) || !isObject(audit.metadata.vulnerabilities)) {
    throw new Error('relatorio sem metadata.vulnerabilities (formato inesperado)');
  }
  if (!isObject(audit.vulnerabilities)) {
    throw new Error('relatorio sem o objeto vulnerabilities (formato inesperado)');
  }
  for (const [name, v] of Object.entries(audit.vulnerabilities)) {
    if (!isObject(v) || !Array.isArray(v.via)) {
      throw new Error(`vulnerabilidade "${name}" sem lista via (formato inesperado)`);
    }
  }
  return audit;
}

function defaultRun() {
  const i = process.argv.indexOf('--input');
  if (i !== -1) {
    try {
      return { stdout: fs.readFileSync(process.argv[i + 1] || '', 'utf8'), status: 0 };
    } catch (error) {
      return { error };
    }
  }
  // npm audit sai com codigo != 0 quando ha vulnerabilidades; o que importa e o JSON.
  return spawnSync('npm', ['audit', '--omit=dev', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * @param {{run?: () => {stdout?: string, stderr?: string, status?: number|null, error?: Error},
 *          today?: string}} opts `run` e injetavel para testes.
 * @returns {{code: number, stdout: string[], stderr: string[]}}
 */
function runGate({ run = defaultRun, today = new Date().toISOString().slice(0, 10) } = {}) {
  const out = [];
  const err = [];
  const fail = (code, msg) => {
    err.push(`FALHA ${msg}`);
    return { code, stdout: out, stderr: err };
  };

  let r;
  try {
    r = run();
  } catch (e) {
    return fail(2, `nao foi possivel executar o npm audit: ${e.message}`);
  }
  if (r.error) return fail(2, `nao foi possivel executar o npm audit: ${r.error.message}`);

  let audit;
  try {
    audit = parseAudit(r.stdout);
  } catch (e) {
    const extra = r.stderr ? ` | stderr: ${String(r.stderr).trim().slice(0, 200)}` : '';
    return fail(2, `${e.message}${extra}`);
  }

  const seen = new Set();
  const unaccepted = [];
  const expired = [];

  for (const vuln of Object.values(audit.vulnerabilities)) {
    for (const via of vuln.via) {
      if (typeof via === 'string') continue; // dependencia transitiva: o advisory real aparece no pacote de origem
      if (!isObject(via) || !BLOCKING.has(via.severity)) continue;
      const key = String(via.source);
      if (seen.has(`${vuln.name}:${key}`)) continue;
      seen.add(`${vuln.name}:${key}`);
      const accepted = ACCEPTED_ADVISORIES[key];
      if (!accepted) {
        unaccepted.push(`${via.severity} ${via.name} ${via.title} (${via.url})`);
      } else if (accepted.expires < today) {
        expired.push(`${accepted.ghsa} ${accepted.pkg}: aceitacao venceu em ${accepted.expires}`);
      }
    }
  }

  const stillSeen = new Set([...seen].map((s) => s.split(':')[1]));
  for (const [id, a] of Object.entries(ACCEPTED_ADVISORIES)) {
    if (!stillSeen.has(id)) {
      out.push(`aviso: ${a.ghsa} (${a.pkg}) nao aparece mais; remova da lista de aceitos.`);
    } else {
      out.push(`aceito ${a.ghsa} ${a.pkg} (desde ${a.acceptedAt}, ate ${a.expires}): ${a.reason}`);
    }
  }

  if (unaccepted.length > 0 || expired.length > 0) {
    for (const u of unaccepted) err.push(`FALHA advisory NOVO nao aceito: ${u}`);
    for (const e of expired) err.push(`FALHA ${e}`);
    return { code: 1, stdout: out, stderr: err };
  }
  out.push('audit gate ok: nenhum advisory high/critical fora da lista de aceitos.');
  return { code: 0, stdout: out, stderr: err };
}

if (require.main === module) {
  const result = runGate();
  for (const l of result.stdout) console.log(l);
  for (const l of result.stderr) console.error(l);
  process.exit(result.code);
}

module.exports = { runGate, parseAudit };
