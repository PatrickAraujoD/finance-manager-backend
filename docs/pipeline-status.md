# Estado do pipeline

Ultima atualizacao: 2026-11-08. Atualize este arquivo a cada execucao relevante do CI.

## Resumo honesto

O pipeline esta ESCRITO e validado so de forma estatica. Ele NUNCA rodou no GitHub: o remoto
`origin` (`https://github.com/PatrickAraujoD/finance-manager-backend`) esta configurado, mas nada
foi enviado (nenhum `git push`). Portanto nenhum job tem resultado real ainda; nao ha "verde" a
declarar para o CI.

## O que existe

| Item | Arquivo | Situacao |
|---|---|---|
| Workflow (lint+tipos, unit, integration-e2e, commitlint, security, build) | `.github/workflows/ci.yml` | escrito, nao executado |
| Audit gate com lista de aceitos | `scripts/audit-gate.js` | executado localmente |
| Dependabot (npm e actions, semanal, minor/patch agrupados) | `.github/dependabot.yml` | escrito, inativo ate o push |
| Template de PR | `.github/pull_request_template.md` | escrito |
| Dockerfile multi-stage e `.dockerignore` | `Dockerfile`, `.dockerignore` | escritos, imagem NAO construida |
| Documentacao | `docs/ci-cd.md` | escrita |

Acoes de terceiros estao fixadas por SHA de commit (resolvidos por `git ls-remote` em 2026-11-08):
`actions/checkout` v6.0.3, `actions/setup-node` v6.5.0, `actions/upload-artifact` v7.0.0.

## O que foi verificado localmente

Verificacoes estaticas desta rodada (DevOps):
- YAML do workflow e do dependabot parseados com `js-yaml` (estrutura valida, 6 jobs).
  `actionlint` nao esta instalado; nao foi usado.
- `node scripts/audit-gate.js` contra o `npm audit` real: sai com 0 listando os 3 advisories
  aceitos. Com um advisory adulterado para um id fora da lista, sai com 1 e imprime
  "advisory NOVO nao aceito".
- Scripts e nomes conferidos contra `package.json`; `tsconfig.build.json` gera `dist/main.js`
  (`rootDir: src`), coerente com `CMD ["node","dist/main.js"]`.

Testes segundo a ultima rodada oficial registrada no historico (nao reexecutados por este agente,
para nao colidir com o banco `finance_test` em uso): 976 unitarios, 165 de integracao e 328 e2e
passando, e `npm run lint` limpo. Esses numeros mudam conforme a Tarefa 9 em correcao avanca.

## Pendencias

1. **Primeiro run real no GitHub:** fazer o push (decisao do usuario), abrir um PR e observar os 6
   jobs. Esperar ajustes: por exemplo, `npx prisma generate` sem `DATABASE_URL`, tempo do OCR no
   e2e (timeout de 30 min do job), comportamento do `commitlint` em push de branch nova.
2. Ligar branch protection exigindo os jobs verdes no `main`.
3. Construir a imagem (`docker build`) e validar o `HEALTHCHECK`; rodar `hadolint`.
4. Definir ambiente de producao e escrever o CD (plano em `docs/ci-cd.md`).
5. **Processo jest travado local:** PIDs 96469 (`npm exec jest ... file-type-detector`) e 96489
   (`node .../jest`) rodando ha horas na maquina do usuario. O DevOps nao os encerrou; cabe ao
   usuario encerra-los (`kill 96469 96489`). Provavel resquicio do teste do detector de tipo
   (a dependencia `file-type` ja foi removida).
6. Revisar os advisories aceitos ate 2027-02-08 (ou antes, se o Prisma 7 for adotado).

## Riscos aceitos

Quatro vulnerabilidades altas no `npm audit --omit=dev` (3 advisories distintos), todas
analisadas:

| Pacote | Advisory | Motivo da aceitacao |
|---|---|---|
| `image-size` (direta) | GHSA-5p2g-fcmc-qvqq, GHSA-w3rx-r6r6-pgpr | Loop infinito em JXL/HEIF/ICNS. Aceitamos so PDF/PNG/JPEG por magic bytes e a lib le so o cabecalho: codigo inalcancavel. Fix exige major. |
| `prisma`, `@prisma/config`, `deepmerge-ts` | GHSA-ggr8-5vv4-36mx | Esgotamento de pilha no merge de config, so no CLI do Prisma em build/migrate. Fix exige Prisma 7 (major). |

A lista fica em `scripts/audit-gate.js`, com data de aceite (2026-11-08) e prazo (2027-02-08).

## Historico de execucoes

| Data | Evento | Resultado |
|---|---|---|
| 2026-11-08 | Workflow criado | Sem execucao (sem push) |
