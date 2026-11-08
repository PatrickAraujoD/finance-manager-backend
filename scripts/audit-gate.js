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

function loadAudit() {
  const i = process.argv.indexOf('--input');
  if (i !== -1) return JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8'));
  // npm audit sai com codigo != 0 quando ha vulnerabilidades; o que importa e o JSON.
  const r = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw new Error(`npm audit nao devolveu JSON valido: ${r.stderr || r.stdout}`);
  }
}

function main() {
  const audit = loadAudit();
  if (audit.error) {
    console.error(`npm audit falhou: ${audit.error.summary || JSON.stringify(audit.error)}`);
    process.exit(2);
  }

  const today = new Date().toISOString().slice(0, 10);
  const seen = new Set();
  const unaccepted = [];
  const expired = [];

  for (const vuln of Object.values(audit.vulnerabilities || {})) {
    for (const via of vuln.via) {
      if (typeof via === 'string') continue; // dependencia transitiva: o advisory real aparece no pacote de origem
      if (!BLOCKING.has(via.severity)) continue;
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
      console.log(`aviso: ${a.ghsa} (${a.pkg}) nao aparece mais; remova da lista de aceitos.`);
    }
  }

  for (const [id, a] of Object.entries(ACCEPTED_ADVISORIES)) {
    if (stillSeen.has(id)) {
      console.log(`aceito ${a.ghsa} ${a.pkg} (desde ${a.acceptedAt}, ate ${a.expires}): ${a.reason}`);
    }
  }

  if (unaccepted.length > 0 || expired.length > 0) {
    for (const u of unaccepted) console.error(`FALHA advisory NOVO nao aceito: ${u}`);
    for (const e of expired) console.error(`FALHA ${e}`);
    process.exit(1);
  }
  console.log('audit gate ok: nenhum advisory high/critical fora da lista de aceitos.');
}

main();
