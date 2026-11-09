# Estado do pipeline

Ultima atualizacao: 2026-11-09. Atualize este arquivo a cada execucao relevante do CI.

## Resumo honesto

O pipeline esta ESCRITO e validado so de forma estatica e local. Ele NUNCA rodou no GitHub: o remoto
`origin` (`https://github.com/PatrickAraujoD/finance-manager-backend`) esta configurado, mas nada
foi enviado (nenhum `git push`). Portanto nenhum job tem resultado real ainda; nao ha "verde" a
declarar para o CI.

## O que existe

| Item | Arquivo | Situacao |
|---|---|---|
| Workflow (lint+tipos+segredos, unit, integration-e2e, commitlint, security, build, docker-build) | `.github/workflows/ci.yml` | escrito, nao executado |
| Audit gate com lista de aceitos (falha fechado) | `scripts/audit-gate.js` | executado localmente, com testes unitarios |
| Varredura de segredos | `scripts/check-secrets.js` | executada localmente, com testes unitarios |
| Dependabot (npm e actions, semanal, minor/patch agrupados) | `.github/dependabot.yml` | escrito, inativo ate o push |
| Template de PR | `.github/pull_request_template.md` | escrito |
| Dockerfile multi-stage e `.dockerignore` | `Dockerfile`, `.dockerignore` | imagem construida e executada localmente pelo reviewer (nao em CI) |
| Documentacao | `docs/ci-cd.md` | escrita |

Acoes de terceiros estao fixadas por SHA de commit (resolvidos por `git ls-remote` em 2026-11-08):
`actions/checkout` v6.0.3, `actions/setup-node` v6.5.0, `actions/upload-artifact` v7.0.0,
`docker/setup-buildx-action` v4.4.1 (f87e5991...) e `docker/build-push-action` v7.4.0 (c3c9e263...).

## O que foi verificado localmente

Verificacoes estaticas desta rodada (DevOps):
- YAML do workflow e do dependabot parseados com `js-yaml` (estrutura valida, 6 jobs).
  `actionlint` nao esta instalado; nao foi usado.
- `node scripts/audit-gate.js` contra o `npm audit` real: sai com 0 listando os 3 advisories
  aceitos. Com um advisory adulterado para um id fora da lista, sai com 1 e imprime
  "advisory NOVO nao aceito".
- Scripts e nomes conferidos contra `package.json`; `tsconfig.build.json` gera `dist/main.js`
  (`rootDir: src`), coerente com `CMD ["node","dist/main.js"]`.

Revisao final (2026-11-08):
- `scripts/audit-gate.js` passou a falhar fechado (testes cobrem `{}`, `[]`, `null`,
  `{"vulnerabilities":null}`, texto, saida vazia e erro de rede). Contra o `npm audit` real: sai 0
  com os 3 advisories aceitos.
- `scripts/check-secrets.js` ampliado (atribuicoes, tokens de fornecedores, entropia, `.envrc`,
  `.env.example` so com placeholders, aviso/falha para arquivos nao lidos). No repositorio: sem
  segredos; avisos so para os 6 binarios de `test/fixtures/` (PDF/PNG).
- Docker: o reviewer construiu a imagem (~5 min, ~1,09 GB), uid 1000, `/data/uploads` 0700,
  healthcheck `healthy`, upload de PDF e PNG com OCR funcionando no conteiner.
- Novo job `docker-build` e passo `check-secrets` no workflow: so validados estaticamente
  (YAML parseado, comandos conferidos no `package.json`).

Contagens da ultima rodada local registrada (2026-11-09, branch `feature/loans`, com as 3 migrations
novas): 1424 unitarios (54 suites); integracao 219 passam e 1 falha de 220 (17 suites); 725 e2e
(22 suites); `tsc --noEmit`, `npm run lint`, `npm run build` e `node scripts/check-secrets.js` sem erro.
A falha de integracao e conhecida e nao e do codigo: `test/integration/env-file.spec.ts` (linha 136)
sobe `src/main.ts` na porta 3000 e recebe `EADDRINUSE` quando outro processo da maquina a ocupa.
Rodando duas suites de banco ao mesmo tempo no mesmo `finance_test` os testes se atropelam; para
rodar em paralelo use outro `TEST_DATABASE_URL` (nome terminado em `_test`). Isto e local: o CI
continua sem ter rodado no GitHub.

## Pendencias

1. **Primeiro run real no GitHub:** fazer o push (decisao do usuario), abrir um PR e observar os 7
   jobs. Esperar ajustes: por exemplo, `npx prisma generate` sem `DATABASE_URL`, tempo do OCR no
   e2e (timeout de 30 min do job), comportamento do `commitlint` em push de branch nova.
2. Ligar branch protection exigindo os jobs verdes no `main`.
3. Rodar `hadolint` e Trivy na imagem (a construcao e o `HEALTHCHECK` ja foram validados
   localmente).
4. Definir ambiente de producao e escrever o CD (plano em `docs/ci-cd.md`).
5. **Processo jest travado local:** PIDs 96469 (`npm exec jest ... file-type-detector`) e 96489
   (`node .../jest`) rodando ha horas na maquina do usuario. O DevOps nao os encerrou; cabe ao
   usuario encerra-los (`kill 96469 96489`). Provavel resquicio do teste do detector de tipo
   (a dependencia `file-type` ja foi removida).
6. Revisar os advisories aceitos ate 2027-02-08 (ou antes, se o Prisma 7 for adotado).
7. **Migrations pelo estagio `build`:** o caminho `docker build --target build` +
   `prisma migrate deploy` NAO foi validado (so o estagio `runtime` foi executado).
8. **Branch protection** a configurar no `main` (exigir os jobs verdes).

## Riscos aceitos

Quatro vulnerabilidades altas no `npm audit --omit=dev` (3 advisories distintos), todas
analisadas:

| Pacote | Advisory | Motivo da aceitacao |
|---|---|---|
| `image-size` (direta) | GHSA-5p2g-fcmc-qvqq, GHSA-w3rx-r6r6-pgpr | Loop infinito em JXL/HEIF/ICNS. Aceitamos so PDF/PNG/JPEG por magic bytes e a lib le so o cabecalho: codigo inalcancavel. Fix exige major. |
| `prisma`, `@prisma/config`, `deepmerge-ts` | GHSA-ggr8-5vv4-36mx | Esgotamento de pilha no merge de config, so no CLI do Prisma em build/migrate. Fix exige Prisma 7 (major). |

A lista fica em `scripts/audit-gate.js`, com data de aceite (2026-11-08) e prazo (2027-02-08).

### Riscos aceitos e pendencias novas da revisao final

| Item | Situacao |
|---|---|
| Suite nunca rodou em Node 22 localmente (local e Node 26; CI e Docker usam 22; `engines` exige >= 22.9) | aceito ate o primeiro run do CI |
| `hadolint` e Trivy nao rodados na imagem | pendente |
| Caminho de migrations pelo estagio `build` nao validado | pendente |
| 429 do upload (`UPLOAD_THROTTLE_LIMIT`) nao testado em producao/atras de proxy | aceito; coberto so por testes automatizados |
| Homoglifos entre escritas (ex.: Cyrillic `і` vs Latin `i`) nao tratados na validacao de texto/e-mail | risco aceito; so invisiveis e spoofing de controle sao tratados |
| Rate limit em memoria, por instancia (varias replicas multiplicam o limite) | aceito; migrar para store compartilhado (Redis) antes de escalar |
| Branch protection nao configurada | pendente (usuario) |

## Historico de execucoes

| Data | Evento | Resultado |
|---|---|---|
| 2026-11-08 | Workflow criado | Sem execucao (sem push) |
| 2026-11-08 | Revisao final: audit gate fechado, check-secrets ampliado, job `docker-build`, docs corrigidos | Sem execucao no GitHub; scripts testados localmente |
