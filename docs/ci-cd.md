# CI/CD do finance-manager-backend

Este guia explica o pipeline de integracao continua (CI), como reproduzi-lo na sua maquina e o que
fazer quando algo falha. Foi escrito para quem esta aprendendo: cada etapa vem com o porque.

> Estado atual (2026-11-08): o workflow esta escrito, mas ainda NAO rodou no GitHub. Veja
> `docs/pipeline-status.md`. A imagem Docker tambem ainda NAO foi construida.

## O que e CI e CD

- **CI (integracao continua):** a cada `push` e `pull_request`, uma maquina limpa baixa o codigo,
  instala tudo do zero e roda as verificacoes. "Na minha maquina funciona" deixa de ser desculpa:
  se passa numa maquina limpa, nao depende de nada que so existe no seu computador.
- **CD (entrega continua):** pegar o que passou no CI e coloca-lo num ambiente. Ainda nao existe
  (ver "O que NAO esta coberto").

O arquivo do pipeline e `.github/workflows/ci.yml`.

## Cuidados gerais do workflow

- `permissions: contents: read`: o token do workflow so le o codigo. Se um passo for comprometido,
  nao consegue escrever no repositorio (principio do menor privilegio).
- `concurrency` com `cancel-in-progress`: um push novo na mesma branch cancela a execucao antiga.
- `timeout-minutes` em todo job: um teste travado nao consome horas de CI.
- Acoes de terceiros fixadas por SHA completo de commit (com o numero da versao em comentario).
  Uma tag como `v4` pode ser movida por quem controla a acao; um SHA nao. O Dependabot propoe as
  atualizacoes. Os SHAs foram resolvidos em 2026-11-08 com `git ls-remote` nos repositorios das
  acoes (nao ha pendencia de pin).
- `persist-credentials: false` no checkout: o token nao fica gravado no `.git` do runner.
- `HUSKY=0`: o `npm ci` roda o script `prepare` (instala hooks de git), inutil no CI.

## Os jobs e por que existem

| Job | O que roda | Por que existe |
|---|---|---|
| `lint-and-typecheck` | `npm ci`, `prisma generate`, `npm run lint`, `npx tsc --noEmit` | O lint inclui as fronteiras de camada (`eslint-plugin-boundaries`): domain/application nao podem importar Nest ou Prisma. O `tsc` pega erros de tipo que o Jest (com `ts-jest`) nao cobre em arquivos sem teste. |
| `unit` | `npm test` | Rapido e sem banco: valida regras de negocio. Falha aqui e feedback em segundos. |
| `integration-e2e` | Postgres 16 como service, `npm run test:integration`, `npm run test:e2e` | Testa SQL real (constraints, indices, `GROUP BY`) e a API HTTP inteira. Mocks nao pegam erro de migration ou de SQL. |
| `commitlint` | `npx commitlint --from base --to head` | Garante a convencao de commits em TODOS os commits do PR, nao so no ultimo. O hook local pode ser pulado (`--no-verify`); o CI nao. |
| `security` | `node scripts/audit-gate.js` | Barra dependencias com vulnerabilidade alta nova, sem esconder os riscos ja aceitos. |
| `build` | `npx tsc -p tsconfig.build.json` | Prova que o codigo de producao compila (`dist/main.js`), com a configuracao que a imagem Docker usa. |

Os jobs rodam em paralelo (nao ha `needs`): o PR mostra todos os problemas de uma vez.

### Detalhes do job `integration-e2e`

- O service container `postgres:16-alpine` tem `health-cmd pg_isready`; o GitHub so inicia os
  passos quando ele esta saudavel.
- Os testes SO aceitam banco cujo nome termine em `_test` (`test/integration/support/test-database.ts`).
  Por isso `DATABASE_URL` e `TEST_DATABASE_URL` apontam para `finance_test`. O `global-setup` cria
  o banco se faltar e roda `prisma migrate deploy`.
- `JWT_ACCESS_SECRET` e gerado a cada execucao com `openssl rand -base64 48`, mascarado com
  `::add-mask::` e exportado em `$GITHUB_ENV`. Nunca ha segredo fixo no repositorio. A senha
  `finance` do Postgres e descartavel: o banco so existe durante o job.
- `UPLOAD_DIR` e um diretorio temporario do runner (`mktemp -d`, modo 0700).
- `procps`: a vigia de memoria do PDF usa `ps` onde nao ha `/proc`. O `ubuntu-latest` ja traz; o
  passo so instala se faltar.
- Em falha, os logs do Postgres sao enviados como artefato (`integration-e2e-logs`, 7 dias). Eles
  nao contem segredos: o ambiente do job nao e impresso e o segredo JWT esta mascarado.

### Detalhes do job `commitlint`

- `fetch-depth: 0` baixa o historico completo; sem isso o intervalo `base..head` nao existe.
- Em `pull_request` valida `base.sha..head.sha`. Em `push` valida `before..sha` (ou so o ultimo
  commit se a branch e nova).

### Detalhes do job `security` e do audit gate

`npm audit --omit=dev --audit-level=high` falharia hoje por 4 vulnerabilidades altas ja
analisadas. Ignorar o resultado esconderia as novas. Por isso `scripts/audit-gate.js`:

- le `npm audit --omit=dev --json`;
- falha se houver advisory `high`/`critical` FORA da lista `ACCEPTED_ADVISORIES` (que traz o id,
  o motivo, a data de aceite e o prazo de revisao `expires`);
- falha tambem se uma aceitacao venceu (obriga a reavaliar);
- avisa se um aceito nao aparece mais (remova da lista).

Aceitos em 2026-11-08 (revisar ate 2027-02-08):

| Advisory | Pacote | Motivo |
|---|---|---|
| GHSA-5p2g-fcmc-qvqq, GHSA-w3rx-r6r6-pgpr | `image-size` | So aceitamos PDF/PNG/JPEG por magic bytes e a lib le so o cabecalho; JXL/HEIF/ICNS nunca chegam ao parser. Correcao exige major. |
| GHSA-ggr8-5vv4-36mx | `deepmerge-ts` (via `prisma`/`@prisma/config`) | Usado so pelo CLI do Prisma em build/migrate, com configuracao nossa. Correcao exige Prisma 7 (major). |

## Rodando localmente o mesmo que o CI roda

Pre-requisitos: Node 22, Docker.

```bash
npm ci
npx prisma generate

# lint-and-typecheck
npm run lint
npx tsc --noEmit

# unit
npm test

# integration-e2e: precisa do Postgres
docker compose up -d                  # Postgres em localhost:5432 (usuario/senha finance)
export JWT_ACCESS_SECRET="$(openssl rand -base64 48)"
export UPLOAD_DIR="$(mktemp -d)"
export DATABASE_URL=postgresql://finance:finance@localhost:5432/finance_test
export TEST_DATABASE_URL=postgresql://finance:finance@localhost:5432/finance_test
npm run test:integration
npm run test:e2e

# commitlint (ultimos N commits, ou o intervalo da sua branch)
npx commitlint --from origin/main --to HEAD --verbose

# security
node scripts/audit-gate.js

# build
npx tsc -p tsconfig.build.json
```

O banco de testes e `finance_test` (separado de `finance`, o de desenvolvimento): o `global-setup`
o cria e migra sozinho. Nunca aponte os testes para um banco que nao termine em `_test`; eles
apagam dados.

## Variaveis de ambiente

Definidas por `loadConfig` (`src/presentation/http/config.ts`) e descritas no `README.md` e em
`.env.example`.

| Variavel | Obrigatoria | No CI |
|---|---|---|
| `DATABASE_URL` | sim | `.../finance_test` do service container |
| `JWT_ACCESS_SECRET` (min. 32 caracteres) | sim | gerada por execucao, mascarada |
| `UPLOAD_DIR` | sim | diretorio temporario 0700 |
| `TEST_DATABASE_URL` | so nos testes | igual a `DATABASE_URL` |
| `PORT`, `CORS_ORIGINS`, `TRUST_PROXY`, throttles, timeouts | nao | padroes (`TRUST_PROXY=false`) |

## Como interpretar falhas comuns

**Banco nao sobe / `ECONNREFUSED` / `P1001`.** Local: `docker compose ps`; se vazio, `docker
compose up -d`; porta 5432 ocupada por outro Postgres? No CI: abra o passo "Initialize
containers" e o artefato `integration-e2e-logs`.

**`TEST_DATABASE_URL must point to a database whose name ends with _test`.** A protecao do setup
funcionou; corrija o nome do banco.

**`Invalid environment configuration: JWT_ACCESS_SECRET`.** Segredo ausente ou com menos de 32
caracteres. Gere com `openssl rand -base64 48`.

**Migration falhou no `global-setup`.** Rode `npx prisma migrate deploy` com a mesma URL para ver
o erro completo (o setup esconde a saida).

**commitlint reprovou.** Regras: `tipo: descricao`, SEM escopo, cabecalho ate 72 caracteres,
tipos `feat fix docs style refactor perf test build ci chore revert`.

| Mensagem | Resultado |
|---|---|
| `feat: add monthly income endpoint` | ok |
| `ci: pin actions by commit sha` | ok |
| `feat(auth): add login` | erro: `scope-empty` (escopo proibido) |
| `Added login` | erro: sem tipo |
| `Feat: Add login.` | erro: tipo em maiuscula / descricao nao pode ter ponto final ou maiuscula inicial |

Para corrigir commits ja feitos no PR: `git rebase -i origin/main`, troque `pick` por `reword`
nos commits ruins e depois `git push --force-with-lease` (apenas na sua branch).

**Politica de commits sem escopo.** O projeto escolheu nao usar escopo (`feat(x):`): o que mudou
fica na descricao. Isso mantem o historico uniforme e a regra simples de checar. O Dependabot esta
configurado com prefixo `chore`/`ci` sem `include: scope` pelo mesmo motivo.

**Audit gate falhou.** Veja a mensagem:
- `advisory NOVO nao aceito`: leia o advisory (link na saida). Se o pacote e de producao e o
  codigo vulneravel e alcancavel, atualize a dependencia (`npm audit fix` ou bump manual) e rode
  os testes. Se e comprovadamente inalcancavel ou so de build, acrescente uma entrada em
  `ACCEPTED_ADVISORIES` com motivo, data e `expires` (maximo 3 meses) e registre em
  `docs/pipeline-status.md`. Nunca aceite sem analisar.
- `aceitacao venceu`: reavalie; se nada mudou, renove `expires` com justificativa em um commit
  `chore:` separado.

**Job cancelado.** Foi o `cancel-in-progress` por um push mais novo; nao e erro.

## O que NAO esta coberto

- **Deploy (CD): nao existe ambiente de producao definido.** Nada publica nem implanta.
- **Dockerfile e `.dockerignore` existem, mas a imagem NAO foi construida nem testada ainda.**
  O primeiro `docker build` pode revelar ajustes. O job de CI tambem nao constroi a imagem.
- Cobertura de testes, testes de carga, SAST/CodeQL, varredura de imagem, SBOM.
- Branch protection (exigir os jobs verdes para merge) e uma configuracao do repositorio no
  GitHub, nao do arquivo; precisa ser ligada em Settings > Branches.

## Plano de CD futuro

1. **Imagem:** `docker build -t finance-manager:<sha> .` (multi-stage `node:22-slim`, usuario
   `node`, `procps` e `openssl` instalados). Publicar em um registry (GHCR) com tag do SHA e
   varrer com Trivy/Grype antes de promover.
2. **Migrations:** passo separado, antes de subir a nova versao, com `npx prisma migrate deploy`.
   O CLI do Prisma e dependencia de desenvolvimento e nao esta na imagem final; use o alvo de build
   (`docker build --target build`) como imagem de migracao. Migrations devem ser compativeis com
   a versao anterior do app (expandir, migrar, contrair) para permitir rollback.
3. **Health check:** `GET /health` -> `{status:"ok"}` (publico). O `HEALTHCHECK` do Dockerfile e a
   readiness do orquestrador devem usa-lo; so desviar trafego depois que responder 200.
4. **Segredos:** `JWT_ACCESS_SECRET` e `DATABASE_URL` vindos de um gerenciador de segredos
   (GitHub Environments secrets, AWS/GCP Secret Manager, Vault), nunca em imagem ou repositorio.
5. **`TRUST_PROXY`:** atras de proxy reverso/balanceador, definir o numero EXATO de saltos
   confiaveis (inteiro >= 1). `true` e `0` sao recusados. Errar permite burlar o rate limit via
   `X-Forwarded-For` ou rate-limitar o IP do proxy.
6. **`UPLOAD_DIR`:** volume persistente montado (ex. `/data/uploads`), dono `node`, permissao
   0700, com backup. Com varias replicas, e preciso storage compartilhado ou objeto (S3); o
   `FileStorage` e uma porta, entao e trocavel.
7. **Rollback:** reimplantar o SHA anterior da imagem; por isso migrations compativeis.
8. Ambientes `staging` e `production` do GitHub com aprovacao manual para producao.

## Runbook de seguranca

**Rotacao do segredo JWT (`JWT_ACCESS_SECRET`).** O access token dura 15 min e e assinado com
este segredo; o refresh token e opaco (hash no banco), sem segredo de assinatura.
1. Gere um novo: `openssl rand -base64 48`.
2. Atualize no gerenciador de segredos e reinicie/reimplante. Todos os access tokens atuais
   deixam de valer (usuarios renovam via refresh sem precisar logar de novo).
3. Suspeita de vazamento? Alem de rotacionar, revogue refresh tokens: marque todos como
   revogados no banco (`UPDATE "RefreshToken" SET "revokedAt" = now() WHERE "revokedAt" IS NULL`)
   para forcar novo login. Faca isso com cuidado e registre o incidente.
4. Rotacione tambem a senha do banco se o `DATABASE_URL` puder ter vazado.
5. Nunca cole segredos em issues, PRs ou logs de CI.

**Audit gate falhou em producao/PR.** Siga a secao "Audit gate falhou" acima: atualizar > aceitar
com analise e prazo > nunca silenciar tudo. Se o advisory e critico e alcancavel, trate como
incidente: corrija e reimplante antes de qualquer feature.

**Segredo commitado por engano.** Considere-o vazado: rotacione primeiro, depois remova do
historico (mas a rotacao e o que protege).
