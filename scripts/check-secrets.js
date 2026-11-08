#!/usr/bin/env node
'use strict';

/**
 * Falha se algum arquivo versionado (`git ls-files`) for um arquivo de ambiente (.env*, .envrc;
 * exceto .env.example) ou contiver padrao de segredo. Uso: `node scripts/check-secrets.js`.
 *
 * Deteccoes:
 *  - formatos de fornecedor: AWS, bloco PEM, GitHub (ghp_/gho_/ghs_/ghu_/ghr_/github_pat_),
 *    Stripe (sk_live_/rk_live_), Google (AIza...), Slack (xox[abprs]-), JWT;
 *  - atribuicao `*SECRET*`/`*PASSWORD*`/`*TOKEN*`/`*API_KEY*` com valor de 16+ caracteres, letras
 *    e digitos e entropia de Shannon alta, em QUALQUER arquivo (inclui yaml/json e `export X=`);
 *  - `.env.example` so pode ter valor vazio ou placeholder obvio nessas chaves (8+ caracteres
 *    reais ja falham);
 *  - URL de banco com senha real (a do Postgres local de desenvolvimento e permitida);
 *  - cadeias longas (>= 40) de hex ou base64 com entropia alta.
 *
 * ALLOWLIST (cada item tem justificativa):
 *  - integridade `sha1-`/`sha256-`/`sha384-`/`sha512-` (package-lock.json e similares): hash
 *    publico de pacote, nao e segredo;
 *  - hash de commit (40 hex) precedido de `commit`, `sha`, `rev`, `ref`, `@` (pin de action) ou
 *    `#` (resolved do lockfile): identificador publico;
 *  - `package-lock.json` e `test/fixtures/`: so ignorados na regra de entropia longa (hashes de
 *    registro e dados de teste gerados); as regras de formato de fornecedor continuam valendo;
 *  - hash de senha argon2 (`$argon2id$...`): formato PHC publico (ha um hash ficticio de tempo
 *    constante no login);
 *  - valores de placeholder (troque, change, example, your, sentinel, xxx, <...>, ${...}, $(...)),
 *    vazios, com menos de 16 caracteres, sem digito, de baixa entropia ou frases em minusculas
 *    separadas por hifen (fixtures como 'wrong-password-1') nas atribuicoes.
 *
 * Arquivos binarios (byte NUL) ou acima de 2 MB nao sao lidos: ficam em `warnings`; se forem
 * arquivo de configuracao conhecido (json, yml, toml, .npmrc, Dockerfile...), viram problema.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const MAX_BYTES = 2_000_000;

// Credencial documentada do Postgres local (docker-compose.yml e .env.example).
const DEV_URL_PASSWORDS = new Set(['finance']);

const CONTENT_RULES = [
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{22,}/],
  ['Stripe live key', /\b[sr]k_live_[0-9a-zA-Z]{16,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/],
];

const URL_WITH_PASSWORD = /\b[a-z][a-z0-9+.-]*:\/\/[^:@\s/'"`]+:([^@\s/'"`]{4,})@/gi;

const ASSIGNMENT =
  /([\w.-]*(?:secret|password|passwd|token|api[_-]?key|private[_-]?key)[\w.-]*)["']?[ \t]*[:=][ \t]*["']?([^\s"'`,;)}\]]+)/gi;

const PLACEHOLDER =
  /(troque|change|replace|example|exemplo|your|placeholder|dummy|fake|sentinel|x{4,}|\*{3,}|<[^>]*>|\$\{|\$\(|\{\{)/i;

const INTEGRITY = /\bsha(?:1|256|384|512)-[A-Za-z0-9+/=]+/g;
const LONG_TOKEN = /[A-Za-z0-9+/_-]{40,}={0,2}/g;
// Hash de senha argon2 (formato PHC) e publico por natureza (ex.: hash fictício de tempo constante).
const PHC_HASH = /\$argon2[a-z]*\$[\w$=,+/-]+/g;
// Frase em minusculas separada por hifen/sublinhado (ex.: 'wrong-password-1'): fixture, nao chave.
const WORDLIKE = /^(?=(?:.*\b[a-z]{3,}\b.*){2})[a-z0-9]+(?:[-_][a-z0-9]+){2,}[!.]*$/;
const VALUE_CHARS = /^[\w+/=.~!@#$%^&*-]+$/;
const COMMIT_CONTEXT = /(?:commit|sha1?|rev|ref|[@#])\s*$/i;

const ENTROPY_SKIP_PATH = /^(?:package-lock\.json|test\/fixtures\/)/;

const CONFIG_NAMES = new Set(['Dockerfile', '.npmrc', '.envrc', '.dockerignore']);
const CONFIG_EXT = /\.(?:json|ya?ml|toml|ini|cfg|conf|properties|env|xml|sh|lock)$/i;

/** Entropia de Shannon em bits por caractere. */
function entropy(str) {
  const counts = new Map();
  for (const ch of str) counts.set(ch, (counts.get(ch) || 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / str.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function baseName(path) {
  return path.split('/').pop();
}

function isEnvFile(path) {
  const name = baseName(path);
  if (name === '.env.example') return false;
  return name === '.env' || name === '.envrc' || name.startsWith('.env.') || name.endsWith('.env');
}

function isConfigFile(path) {
  const name = baseName(path);
  return CONFIG_NAMES.has(name) || CONFIG_EXT.test(name) || name.startsWith('.env');
}

function looksLikeRealSecret(value, strict) {
  if (PLACEHOLDER.test(value)) return false;
  if (strict) return value.length >= 8; // .env.example: qualquer valor nao-placeholder
  if (value.length < 16 || !VALUE_CHARS.test(value) || WORDLIKE.test(value)) return false;
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return false;
  return entropy(value) >= 3.3;
}

function longTokenProblem(token, before) {
  const isHex = /^[0-9a-f]+$/i.test(token);
  if (isHex) {
    if (token.length === 40 && COMMIT_CONTEXT.test(before)) return false;
    return entropy(token) >= 3.3;
  }
  if (!/\d/.test(token) || !/[a-z]/.test(token) || !/[A-Z]/.test(token)) return false;
  return entropy(token) >= 4.3;
}

/**
 * @param {{path: string, content: string, skipped?: 'binary'|'too large'}[]} files
 * @returns {{problems: string[], warnings: string[]}}
 */
function scan(files) {
  const problems = [];
  const warnings = [];
  for (const { path, content, skipped } of files) {
    if (isEnvFile(path)) problems.push(`${path}: env file must not be versioned`);
    if (skipped) {
      const msg = `${path}: not scanned (${skipped})`;
      if (isConfigFile(path)) problems.push(`${msg}; a config file must be scannable`);
      else warnings.push(`warning: ${msg}`);
      continue;
    }
    const found = new Set();
    for (const [name, re] of CONTENT_RULES) {
      if (re.test(content)) found.add(`looks like ${name}`);
    }
    for (const m of content.matchAll(URL_WITH_PASSWORD)) {
      if (!DEV_URL_PASSWORDS.has(m[1])) {
        found.add('URL with an embedded password');
        break;
      }
    }
    const strict = baseName(path) === '.env.example';
    for (const m of content.matchAll(ASSIGNMENT)) {
      if (looksLikeRealSecret(m[2], strict)) {
        found.add(
          strict
            ? `${m[1]} in .env.example must be empty or an obvious placeholder`
            : `${m[1]} assigned a value that looks like a real secret`,
        );
      }
    }
    if (!ENTROPY_SKIP_PATH.test(path)) {
      for (const line of content.split('\n')) {
        const clean = line.replace(INTEGRITY, '').replace(PHC_HASH, '');
        for (const m of clean.matchAll(LONG_TOKEN)) {
          if (longTokenProblem(m[0], clean.slice(Math.max(0, m.index - 12), m.index))) {
            found.add('long high-entropy hex/base64 string');
          }
        }
      }
    }
    for (const f of found) problems.push(`${path}: ${f}`);
  }
  return { problems, warnings };
}

/** @returns {string[]} one line per problem (warnings are available through `scan`) */
function findProblems(files) {
  return scan(files).problems;
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
      if (buf.length > MAX_BYTES) return { path, content: '', skipped: 'too large' };
      if (buf.includes(0)) return { path, content: '', skipped: 'binary' };
      return { path, content: buf.toString('utf8') };
    });
}

if (require.main === module) {
  const { problems, warnings } = scan(trackedFiles());
  for (const w of warnings) console.warn(w);
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log('No secrets found in tracked files.');
}

module.exports = { findProblems, scan, entropy };
