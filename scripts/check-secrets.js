#!/usr/bin/env node
'use strict';

/**
 * Falha se algum arquivo versionado (`git ls-files`) for um .env (exceto .env.example) ou
 * contiver um padrao obvio de segredo. Uso: `node scripts/check-secrets.js`.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

// Credencial documentada do Postgres local (docker-compose.yml e .env.example).
const DEV_URL_PASSWORDS = new Set(['finance']);

const CONTENT_RULES = [
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/],
];

const URL_WITH_PASSWORD = /\b[a-z][a-z0-9+.-]*:\/\/[^:@\s/'"`]+:([^@\s/'"`]{4,})@/gi;

function isEnvFile(path) {
  const name = path.split('/').pop();
  if (name === '.env.example') return false;
  return name === '.env' || name.startsWith('.env.') || name.endsWith('.env');
}

/** @param {{path: string, content: string}[]} files @returns {string[]} one line per problem */
function findProblems(files) {
  const problems = [];
  for (const { path, content } of files) {
    if (isEnvFile(path)) problems.push(`${path}: env file must not be versioned`);
    for (const [name, re] of CONTENT_RULES) {
      if (re.test(content)) problems.push(`${path}: looks like ${name}`);
    }
    for (const m of content.matchAll(URL_WITH_PASSWORD)) {
      if (!DEV_URL_PASSWORDS.has(m[1])) {
        problems.push(`${path}: URL with an embedded password`);
        break;
      }
    }
  }
  return problems;
}

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  return out
    .split('\0')
    .filter(Boolean)
    .map((path) => {
      let buf;
      try {
        buf = fs.readFileSync(path);
      } catch {
        return { path, content: '' }; // deleted in the working tree
      }
      const binary = buf.length > 2_000_000 || buf.includes(0);
      return { path, content: binary ? '' : buf.toString('utf8') };
    });
}

if (require.main === module) {
  const problems = findProblems(trackedFiles());
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log('No secrets found in tracked files.');
}

module.exports = { findProblems };
