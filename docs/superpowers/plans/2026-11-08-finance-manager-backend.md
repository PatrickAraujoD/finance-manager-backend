# Finance Manager Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** API REST de gestão financeira pessoal: autenticação segura, salário mensal, comprovantes (PDF com texto / imagem) com extração de valor confirmada pelo usuário, gastos categorizados e relatórios para gráficos.

**Architecture:** Arquitetura Limpa em quatro camadas (`domain` ← `application` ← `infrastructure` / `presentation`). Casos de uso são classes TypeScript puras que recebem portas (interfaces) pelo construtor; NestJS só faz a fiação e expõe HTTP. Dinheiro sempre em centavos inteiros.

**Tech Stack:** TypeScript, NestJS (apenas `presentation`), PostgreSQL + Prisma (apenas `infrastructure`), Jest + supertest, argon2, `jsonwebtoken`, `@nestjs/throttler`, helmet, class-validator, zod, date-fns, multer, image-size, pdf-parse, tesseract.js, eslint-plugin-boundaries, Docker Compose, npm.

**Spec:** `docs/superpowers/specs/2026-11-08-finance-manager-backend-design.md`

## Global Constraints

- TDD estrito: teste vermelho (rodado e visto falhar) → código mínimo → verde → commit.
- `src/domain` e `src/application` NÃO importam `@nestjs/*`, `@prisma/client` nem libs de infra (argon2, jwt, tesseract, pdf-parse...). Violação quebra o lint.
- Biblioteca madura antes de algoritmo próprio; sempre atrás de uma porta.
- Dinheiro = inteiro em centavos (`Money` próprio sobre inteiro em centavos, sem dependência; decisão do usuário após revisão: dinero.js é ESM-only). Nunca `number` float em regra de negócio.
- Papéis: `'A'` (admin) e `'N'` (normal). Admin NÃO lê gastos/salário de outros usuários.
- Autorização (dono do recurso / papel) é feita nos casos de uso, não só em guards.
- Upload: máx. 5 MB; tipos PDF/PNG/JPEG validados por magic bytes; nome de arquivo aleatório.
- Guard global fail-closed: `JwtAuthGuard` e depois `RolesGuard` são `APP_GUARD` (após o throttler); toda rota é privada a menos que marcada com `@Public()`. Públicas hoje, exatamente: `GET /health`, `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` (um teste e2e lista as rotas e trava esse conjunto). Não usar `@UseGuards` para autenticação.
- `ValidationError` do domínio -> HTTP 400 (mesmo status da validação de DTO), nunca 422.
- Texto sem NUL (`\u0000`) e sem surrogates soltos: rejeitado no domínio (`requireNonBlank`/`requireCleanText` em todo campo de texto das entidades e `Email`) e nos DTOs (`@CleanText()`), para nunca virar 500 do Postgres (`22021`).
- `TRUST_PROXY` aceita só `false` (padrão) ou inteiro >= 1 (número exato de saltos); `true`, `0` e strings livres derrubam a subida (evita burlar o rate limit por `X-Forwarded-For`).
- Throttle de `/auth/login` por IP + e-mail normalizado (trim+lowercase, truncado e hasheado: chave de tamanho fixo), além do limite por IP (`AUTH_THROTTLE_LIMIT`, padrão 20; `LOGIN_EMAIL_THROTTLE_LIMIT`, padrão 5).
- Access token 15 min; refresh token rotativo, guardado só como hash; reuso de refresh revoga a família.
- `Expense.spentAt` é uma DATA DE CALENDÁRIO guardada como `Date` às 00:00 UTC (decisão do CTO; evita deslocar compras de fuso). `Expense.create` normaliza para 00:00 UTC do mesmo dia UTC; agrupamentos por dia/mês e limites de filtro são feitos em UTC.
- npm (pnpm ausente).
- **Commits: Conventional Commits 1.0.0, estritamente**, validados por `commitlint` (`@commitlint/config-conventional`) num hook `commit-msg` do `husky`. Ver seção "Convenção de commits" abaixo.

## Convenção de commits (vale para TODAS as tarefas)

O ciclo TDD gera commits pequenos e separados. Onde uma tarefa disser "Commit" no fim, leia como o ciclo abaixo, repetido a cada comportamento novo:

| Fase TDD | Commit | Tipo |
|---|---|---|
| Red | teste novo, visto falhando | `test: ...` |
| Green | código mínimo que faz passar | `feat: ...` (ou `fix` se corrige bug) |
| Refactor | limpeza sem mudar comportamento, testes verdes | `refactor: ...` |
| Config | deps, scripts, lint, docker, CI | `chore: ...`, `build: ...`, `ci: ...` |
| Docs | README, specs, planos | `docs: ...` |

Regras estritas:
- Formato: `<tipo>: <descrição>`. **Sem escopo**: `feat(auth): ...` é inválido; o que mudou fica na descrição. Tipos permitidos: `feat fix docs style refactor perf test build ci chore revert`.
- Descrição no imperativo, minúscula inicial, sem ponto final; cabeçalho com até 72 caracteres.
- Corpo opcional, separado por linha em branco, explicando o porquê.
- Mudança incompatível: `!` após o tipo (`feat!: ...`) e rodapé `BREAKING CHANGE: ...`.
- **Sem rodapé de coautoria** (pedido do usuário): nenhum commit leva `Co-Authored-By` nem outra linha de atribuição.
- Um commit = uma intenção. Nunca misturar teste novo com implementação no mesmo commit, nem refactor com feature.
- O hook só valida a mensagem. Não há hook que rode testes no commit, para permitir o commit vermelho (`test:`); a suíte roda no CI e antes de cada merge.
- Exemplos: `test: reject login for locked account`, `feat: lock account after five failed logins`, `refactor: extract lockout policy`, `chore: add argon2`.
- Nas tarefas abaixo, mensagens como `feat(auth): ...` ou `feat(domain): ...` são só o rótulo do assunto: ao commitar, escrever sem o escopo (`feat: add auth register, login and refresh`).

## Review Focus

- Valor extraído ilegível/ausente (PDF sem "R$", OCR lixo): API devolve `suggestedAmountCents: null` e o usuário informa manualmente; nunca 500.
- Valores BRL em formatos variados ("R$ 1.234,56", "1234,56", "R$1.234,56"): lidos corretamente em centavos.
- `paidAlone=false` sem `amountCents` informado: 422; com `paidAlone=false` o extrator NUNCA é chamado.
- Arquivo com extensão/Content-Type de PDF mas conteúdo diferente, ou vazio, ou > 5 MB: rejeitado.
- Mês sem gastos ou sem salário cadastrado: relatórios retornam listas vazias / `incomeCents: null`, sem erro.
- Excluir categoria em uso por gastos: bloqueado (409), sem apagar gastos.
- Refresh token reutilizado após rotação: família inteira revogada.
- Usuário `N` acessando rota de admin, ou usuário A lendo recurso de B: 403/404 sem vazar existência.
- Email duplicado com caixa diferente (`A@x.com` vs `a@x.com`): tratado como o mesmo.

---

## File Structure

```
src/domain/{money.ts,email.ts,role.ts,errors.ts}
src/domain/entities/{user.ts,category.ts,expense.ts,receipt.ts,monthly-income.ts,refresh-token.ts}
src/application/ports/{user-repository.ts,category-repository.ts,expense-repository.ts,receipt-repository.ts,income-repository.ts,refresh-token-repository.ts,password-hasher.ts,token-service.ts,file-storage.ts,receipt-extractor.ts,clock.ts,id-generator.ts,report-repository.ts}
src/application/use-cases/{auth,users,categories,income,receipts,expenses,reports}/*.ts
src/infrastructure/{prisma/,hashing/,tokens/,storage/,extraction/,system/}
src/presentation/http/{modules,controllers,dtos,guards,filters}/
src/main.ts
test/{unit mirrors src,integration,e2e}
prisma/schema.prisma   docker-compose.yml   .env.example   eslint.config.mjs
```

---

### Task 1: Scaffold e fronteiras de camada

**Files:**
- Create: `package.json`, `tsconfig.json`, `jest.config.ts`, `eslint.config.mjs`, `docker-compose.yml`, `.env.example`, `prisma/schema.prisma`, `src/main.ts`, `src/presentation/http/modules/app.module.ts`, `src/presentation/http/controllers/health.controller.ts`
- Test: `test/e2e/health.e2e-spec.ts`, `test/unit/architecture.spec.ts`

**Interfaces:**
- Produces: `GET /health` → `{ status: 'ok' }`; scripts `npm test`, `test:integration`, `test:e2e`, `lint`; Postgres em `localhost:5432` via `docker compose up -d`; `loadConfig(env): AppConfig` em `src/presentation/http/config.ts` (zod; falha na subida se faltar `DATABASE_URL`, `JWT_ACCESS_SECRET`, `UPLOAD_DIR`; o refresh token é opaco, sem segredo de assinatura).

- [ ] **Step 1:** Criar o projeto Nest/TS com as deps do Tech Stack e as pastas de camadas (arquivos `.gitkeep`).
- [ ] **Step 2:** Escrever `architecture.spec.ts`: usando `eslint` programático (ou `dependency-cruiser`), afirmar que um arquivo fictício em `src/domain` importando `@nestjs/common` gera erro de lint. Rodar e ver falhar.
- [ ] **Step 3:** Configurar `eslint-plugin-boundaries` com a direção domain ← application ← infrastructure/presentation, mais proibição de `@nestjs/*` e `@prisma/client` em domain/application. Rodar: PASS.
- [ ] **Step 4:** Escrever `health.e2e-spec.ts` (supertest `GET /health` → 200 `{status:'ok'}`) e `config.spec.ts` (`loadConfig({})` lança; com vars válidas retorna objeto). Ver falhar, implementar `HealthController` e `loadConfig`, ver passar.
- [ ] **Step 5:** `docker compose up -d`, `npx prisma migrate dev` com schema vazio, `npm test`, `npm run lint`: tudo verde.
- [ ] **Step 6:** Instalar `husky`, `@commitlint/cli`, `@commitlint/config-conventional`; criar `commitlint.config.mjs` estendendo o config convencional com `scope-empty: [2, 'always']` (proíbe escopo), `header-max-length: 72`; hook `.husky/commit-msg` rodando `commitlint --edit "$1"`. Teste `test/unit/commit-convention.spec.ts` usando `@commitlint/lint`: `feat: add login` é válido; `Added login`, `feat(auth): add login` (com escopo), `FEAT: x` e `feat: Add login.` são inválidos.
- [ ] **Step 7:** Verificar o hook de verdade: `git commit --allow-empty -m "bad message"` deve ser rejeitado.
- [ ] **Step 8:** Commits separados: `chore: scaffold nest project`, `build: add testing and lint tooling`, `chore: enforce layer boundaries`, `chore: add commitlint and husky`, `test: cover commit convention rules`.

### Task 2: Domínio base (Money, Email, Role, erros)

**Files:**
- Create: `src/domain/money.ts`, `email.ts`, `role.ts`, `errors.ts`
- Test: `test/unit/domain/{money,email,role}.spec.ts`

**Interfaces:**
- Produces:
  - `class Money { static fromCents(cents: number): Money; static parseBRL(text: string): Money | null; get cents(): number; add(o: Money): Money; subtract(o: Money): Money; isNegative(): boolean; equals(o: Money): boolean }`
  - `class Email { static create(raw: string): Email; get value(): string }` (normaliza para minúsculas, valida formato com lib `validator`)
  - `type Role = 'A' | 'N'; function parseRole(v: string): Role`
  - Erros: `DomainError` base e `ValidationError`, `NotFoundError`, `ForbiddenError`, `ConflictError`, `UnauthorizedError`.

- [ ] **Step 1:** Testes de `Money`: `fromCents(1050).cents === 1050`; `fromCents(1.5)` lança; `add`/`subtract` corretos; `parseBRL('R$ 1.234,56').cents === 123456`; `parseBRL('1234,56')`, `parseBRL('R$1.234,56')` idem; `parseBRL('abc')` → `null`. Ver falhar.
- [ ] **Step 2:** Implementar `Money` próprio sobre inteiro em centavos (add/subtract validam `Number.isSafeInteger`, sem `-0`); `parseBRL` com regex estrita pt-BR. Sem dinero.js/numbro (decisão do usuário após revisão: dinero.js é ESM-only).
- [ ] **Step 3:** Testes e implementação de `Email` (`A@X.com` → `a@x.com`; inválido lança `ValidationError`) e `Role`.
- [ ] **Step 4:** `npm test` verde; commit `feat(domain): money, email, role`.

### Task 3: Entidades e portas

**Files:**
- Create: `src/domain/entities/*.ts`, `src/application/ports/*.ts`
- Test: `test/unit/domain/entities.spec.ts`

**Interfaces:**
- Produces entidades (todas imutáveis, com `static create(...)` validando invariantes):
  - `User { id, name, email: Email, passwordHash, role: Role, active, failedLogins, lockedUntil: Date|null }` com `registerFailedLogin(now, maxAttempts, lockMinutes)`, `isLocked(now)`, `resetFailedLogins()`.
  - `Category { id, name, ownerId: string|null }`; `isGlobal()`.
  - `Expense { id, userId, categoryId, receiptId: string|null, amount: Money, paidAlone, spentAt: Date, description? }`.
  - `Receipt { id, userId, storageKey, mimeType, sizeBytes, suggestedAmount: Money|null }`.
  - `MonthlyIncome { userId, month: string /*YYYY-MM*/, amount: Money }`.
  - `RefreshToken { id, userId, familyId, tokenHash, expiresAt, revokedAt|null }`.
- Produces portas (assinaturas async, tipos acima): `UserRepository {save, findById, findByEmail, list}`, `CategoryRepository {save, findById, listVisibleTo(userId), delete, isInUse(id)}`, `ExpenseRepository {save, findById, listByUser(userId, filter), delete}`, `ReceiptRepository {save, findById}`, `IncomeRepository {upsert, find(userId, month)}`, `RefreshTokenRepository {save, findByHash, revokeFamily(familyId)}`, `PasswordHasher {hash(plain), verify(hash, plain)}`, `TokenService {signAccess({sub, role}), verifyAccess(token), generateRefresh(): {token, hash}}`, `FileStorage {save(buffer, ext): Promise<string>, read(key): Promise<Buffer>, delete(key)}`, `ReceiptExtractor {extract(buffer, mimeType): Promise<{amount: Money|null, confidence: number}>}`, `Clock {now(): Date}`, `IdGenerator {next(): string}`, `ReportRepository` (ver Task 9).

- [ ] **Step 1:** Testes: `Expense.create` rejeita valor ≤ 0; `User.registerFailedLogin` trava ao atingir o limite; `isLocked` volta a `false` após `lockedUntil`; `Category.isGlobal` true com `ownerId=null`; `MonthlyIncome.create` rejeita mês fora de `YYYY-MM`. Ver falhar.
- [ ] **Step 2:** Implementar entidades e declarar as portas (só tipos). Testes verdes.
- [ ] **Step 3:** Criar também fakes em memória em `test/support/fakes/*.ts` para todas as portas (usados pelos testes de casos de uso).
- [ ] **Step 4:** Commit `feat(domain): entities and ports`.

### Task 4: Autenticação (register, login, refresh, logout)

**Files:**
- Create: `src/application/use-cases/auth/{register-user,login,refresh-session,logout}.ts`; `src/infrastructure/hashing/argon2-hasher.ts`; `src/infrastructure/tokens/jwt-token-service.ts`; `src/infrastructure/prisma/{prisma.service.ts,prisma-user.repository.ts,prisma-refresh-token.repository.ts}`; `src/presentation/http/{controllers/auth.controller.ts,dtos/auth.dto.ts,guards/jwt-auth.guard.ts,guards/roles.guard.ts,filters/domain-error.filter.ts}`
- Test: `test/unit/application/auth/*.spec.ts`, `test/integration/prisma-user.repository.spec.ts`, `test/e2e/auth.e2e-spec.ts`

**Interfaces:**
- Produces: `RegisterUser.execute({name,email,password}): Promise<{id}>` (senha mínima 12 chars; role sempre `'N'`; email duplicado → `ConflictError`); `Login.execute({email,password}): Promise<{accessToken, refreshToken}>`; `RefreshSession.execute({refreshToken})` retorna novo par; `Logout.execute({refreshToken})`. Constantes: 5 falhas → bloqueio 15 min. `@Roles('A')` funciona sem `@UseGuards` (guards globais); o guard JWT expõe `req.user = {id, role}`; rotas abertas usam `@Public()`. `DomainErrorFilter` mapeia erros de domínio → 400 (`ValidationError`)/401/403/404/409 sem stack.

- [ ] **Step 1:** Testes unitários (fakes): register cria usuário `N` com hash (≠ senha); email duplicado em caixa diferente → `ConflictError`; senha curta → `ValidationError`; login ok devolve tokens; senha errada e usuário inexistente lançam o MESMO `UnauthorizedError` (mensagem genérica); 5ª falha bloqueia e login correto durante bloqueio falha; **durante o bloqueio o caso de uso retorna o mesmo `UnauthorizedError` genérico SEM chamar `registerFailedLogin`** (o bloqueio não desliza); login e refresh também recusam usuário inativo (`active === false`); refresh rotaciona (token antigo vira revogado); **reuso de refresh antigo revoga a família** e o novo token também deixa de funcionar; logout revoga.
- [ ] **Step 2:** Rodar e ver falhar; implementar os casos de uso; verde.
- [ ] **Step 3:** Adaptadores: `Argon2Hasher` (argon2id), `JwtTokenService` (access 15 min; refresh = 48 bytes aleatórios via `crypto.randomBytes`, hash SHA-256 salvo), repositórios Prisma + migration (`User`, `RefreshToken`). Teste de integração do repositório contra o Postgres do Compose.
- [ ] **Step 4:** Controller + DTOs (class-validator, whitelist, `forbidNonWhitelisted`), guards, filtro de erros; throttler global e limite mais baixo em `/auth/*`; `helmet`. E2E: registrar → login → rota protegida 200; sem token 401; token expirado 401; 6ª tentativa seguida de login em 1 min → 429.

**Requisitos da Parte B (revisão de segurança da Parte A):**
- Rotação do refresh atômica via `RefreshTokenRepository.rotate(oldId, replacement, now)`: numa única transação revoga o antigo somente se ainda ativo e grava o novo (atendido por `rotate`; se a gravação falhar, nada é revogado; o access token é assinado antes, então falha de emissão não perde a sessão).
- `UserRepository.mutate` com transação e lock de linha (`SELECT ... FOR UPDATE`) no Prisma; teste de integração de concorrência contra o Postgres.
- Índice UNIQUE em `email` (P2002 -> `ConflictError`); índices em `tokenHash` (unique), `familyId` e `userId`; `revokeFamily`/`revokeAllByUser` com `updateMany ... WHERE revokedAt IS NULL`.
- Throttler (rate limit por IP) em `/auth/login`, `/auth/register` e `/auth/refresh`; DTO de login com senha de no máximo 128 caracteres e limite de tamanho do body.
- O guard JWT é global (`APP_GUARD`, fail-closed, `@Public()` para exceções), usa `JwtTokenService.verifyAccess` (não `@nestjs/jwt`) e rejeita usuário inativo (consulta o repositório).
- Throttle do login por IP + e-mail normalizado, além do limite por IP; `TRUST_PROXY` só `false` ou inteiro >= 1; texto sem NUL/surrogates soltos (domínio e DTO).
- `.env.example` instrui gerar segredos com `openssl rand -base64 48`.

- [ ] **Step 5:** Commit `feat(auth): register, login, refresh rotation, logout`.

### Task 5: Usuários (admin) e Categorias

**Files:**
- Create: `src/application/use-cases/users/{list-users,update-user}.ts`, `src/application/use-cases/categories/{create-category,update-category,delete-category,list-categories}.ts`; `prisma-category.repository.ts`; controllers/DTOs correspondentes; seed de admin via script `prisma/seed.ts` (lê `ADMIN_EMAIL`/`ADMIN_PASSWORD` do ambiente)
- Test: `test/unit/application/{users,categories}/*.spec.ts`, `test/e2e/{users,categories}.e2e-spec.ts`

**Interfaces:**
- Consumes: ports e guards da Task 4.
- Produces: `ListUsers.execute(actor)` / `UpdateUser.execute(actor, id, {role?, active?})` (só admin; admin não pode se rebaixar nem desativar a si mesmo); `CreateCategory.execute(actor, {name, global?})` (`global` só admin); `ListCategories.execute(actor)` → globais + próprias; `UpdateCategory`/`DeleteCategory(actor, id)`: dono edita a própria, só admin edita global; excluir categoria em uso → `ConflictError`. Desativar um usuário (`active: false`) chama `RefreshTokenRepository.revokeAllByUser(id)`; refresh e login checam `active` e recusam usuário inativo.

- [ ] **Step 1:** Testes unitários: `N` listando usuários → `ForbiddenError`; admin muda papel de outro; admin tentando desativar a si mesmo → erro; `N` criando categoria global → `ForbiddenError`; nome duplicado no mesmo escopo → `ConflictError`; usuário B editando categoria de A → `NotFoundError`; excluir em uso → `ConflictError`. Ver falhar.
- [ ] **Step 2:** Implementar casos de uso e repositório Prisma (unique `(ownerId, name)`; atenção a `NULL` em `ownerId`: índice parcial único para globais, via SQL na migration). Verde.
- [ ] **Step 3:** Controllers, DTOs, e2e (N → 403 em `/users`; categorias globais visíveis a todos).
- [x] **Step 4:** Commit `feat: user admin and categories` (feito em commits `test:`/`feat:` separados).

**Decisões e desvios da Tarefa 5 (implementada):**
- `Actor {id, role}` em `src/application/actor.ts`; o papel vem do banco (o `JwtAuthGuard` o relê a cada request), não do token.
- `UpdateUser.execute(actor, id, {role?, active?})` devolve o `User`. Auto-rebaixamento/auto-desativação -> `ForbiddenError` (403). Corpo vazio -> `ValidationError`. Defesa extra (ator obsoleto): rebaixar/desativar o único admin ativo restante -> `ConflictError` (409). Limite conhecido: duas requisições simultâneas de admins se rebaixando mutuamente não são serializadas (o `mutate` trava só a linha alvo); exigiria uma porta nova com lock global e foi deixado de fora.
- `active: false` chama `revokeAllByUser`; o access token já emitido deixa de valer na próxima requisição (o guard checa `active`).
- Categorias: `Category.nameKey` (NFC + minúsculas, sobre o nome já com trim) e limite de 60 caracteres no domínio. Unicidade: `UNIQUE(ownerId, nameKey)` + índice parcial único `WHERE "ownerId" IS NULL` (SQL na migration `20261108180000_categories_expenses`), mais CHECK `amountCents > 0`. Contrato das portas: `CategoryRepository.save` lança `ConflictError` para nome duplicado no escopo e `delete` lança `ConflictError` se houver gastos (FK `ON DELETE RESTRICT`); o fake imita ambos. Conflito de nome é detectado pelo banco (sem `findByName`), logo sem corrida check-then-insert.
- `UpdateCategory.execute(actor, id, {name})`; `CreateCategory` devolve `{id}`. Categoria alheia (inclusive para admin) -> `NotFoundError`; global editada por não-admin -> `ForbiddenError`.
- `Expense` entra só como schema (`amountCents BIGINT`, `spentAt DATE`, FKs Restrict; `receiptId` é coluna simples até existir `Receipt`); o repositório continua na Tarefa 8.
- `User.createdAt` (nulo até persistir) foi adicionado à entidade para a resposta de `GET /users`; respostas usam lista explícita de campos (`views.ts`), nunca `passwordHash`.
- HTTP: `GET /users`, `PATCH /users/:id` (`@Roles('A')`, DTO com `ValidateIf` para rejeitar `null`), `GET/POST /categories`, `PATCH/DELETE /categories/:id` (204); ids com `ParseUUIDPipe` (400). Nenhuma nova rota pública (inventário continua com as 5).
- Seed: `prisma/seed.ts` (`npm run seed`), caso de uso `EnsureAdmin` (regra de senha extraída para `auth/password-policy.ts` e compartilhada com `RegisterUser`); idempotente, nunca altera conta existente nem imprime a senha. Documentado no README/.env.example.

**Ajustes da revisão da Tarefa 5 (implementados):**
- Seed: `EnsureAdmin` devolve `{created, state}` com `state` em `created | admin-exists | not-admin`. Conta existente que não é admin ATIVO (usuário `N` ou admin inativo) -> `not-admin`: nada é alterado (nunca promove), o seed (`runSeedCli`) escreve "Account exists but is not an active admin; promote it manually" e sai com código 1. Admin ativo -> "nothing changed", código 0. A senha nunca é logada. Corrida entre dois seeds: o perdedor reclassifica o vencedor.
- `Category.create` guarda o nome em NFC, com espaços internos repetidos colapsados em um e com trim; `nameKey` deriva desse nome (`'a  b'` e `'a b'` colidem). O limite de 60 é medido em pontos de código (`Array.from(name).length`); o DTO usa só um limite frouxo de 120 unidades UTF-16 e o domínio decide.
- Teto de 100 categorias PRÓPRIAS por usuário (`MAX_OWNED_CATEGORIES` em `create-category.ts`): o 101º `CreateCategory` -> `ConflictError` (409); globais não contam. Porta `CategoryRepository.countOwnedBy(userId)` (fake e Prisma). É count-then-insert, então criações simultâneas podem ultrapassar o teto por pouco; aceitável para um limite de segurança leve.
- `GET /users` e `GET /categories` seguem sem paginação, mas `MAX_LIST_RESULTS = 500` (`src/application/ports/limits.ts`) vira `take` nos repositórios Prisma (ordenação estável). Paginação real fica para depois, se for necessária.

### Task 6: Renda mensal

**Files:**
- Create: `src/application/use-cases/income/{set-monthly-income,get-monthly-income}.ts`, `prisma-income.repository.ts`, controller/DTO
- Test: `test/unit/application/income/*.spec.ts`, `test/e2e/income.e2e-spec.ts`

**Interfaces:**
- Produces: `SetMonthlyIncome.execute(actor, {month, amountCents})` (upsert); `GetMonthlyIncome.execute(actor, month): Promise<{month, amountCents} | null>`. Rotas `PUT/GET /income/:month`.

- [ ] **Step 1:** Testes: upsert sobrescreve o mês; valor ≤ 0 → `ValidationError`; mês `2026-13` → erro; usuário só vê o próprio salário. Ver falhar.
- [ ] **Step 2:** Implementar, e2e, verde.
- [ ] **Step 3:** Commit `feat: monthly income`.

**Decisões e desvios da Tarefa 6 (implementada):**
- Casos de uso `SetMonthlyIncome.execute(actor, {month, amountCents})` (devolve `{month, amountCents}`) e `GetMonthlyIncome.execute(actor, month)` (`{month, amountCents} | null`). O dono é sempre `actor.id`: não há `userId` na rota nem no corpo (campo extra -> 400), e admin também só enxerga o próprio.
- Valor máximo: `MAX_INCOME_CENTS = 100_000_000_000` (R$ 1 bilhão), no domínio (`MonthlyIncome.create`, `ValidationError`); muito abaixo de `MAX_SAFE_INTEGER`, então somas de relatórios não estouram. `requireMonth` (regex estrita `YYYY-MM`, mês 01-12) é exportado e usado também no `GET`.
- DTO `SetIncomeDto`: `@IsInt() @Min(1) @Max(MAX_INCOME_CENTS)`; sem conversão implícita, então string, float, null, booleano, array, 0, negativo e gigante -> 400.
- Prisma: `MonthlyIncome` com PK composta `(userId, month)`, `amountCents BIGINT`, CHECK de formato do mês (`~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`) e CHECK `amountCents > 0` (SQL na migration `20261108190000_monthly_income`). FK `ON DELETE CASCADE` (decisão: a linha não tem sentido sem o usuário e é só dado derivado; diferente de gastos/categorias, que usam Restrict). `PrismaIncomeRepository.upsert` usa o `upsert` do Prisma sobre a PK composta (um único `INSERT ... ON CONFLICT DO UPDATE`): dois upserts simultâneos no mesmo mês não falham e vence um dos dois (teste de integração repete 10 vezes). Na leitura, BIGINT acima de `MAX_SAFE_INTEGER` -> erro, nunca arredonda.
- HTTP: `PUT /income/:month` -> 200 `{month, amountCents}`; `GET /income/:month` -> 200 com o valor ou 404 quando não há salário (escolha: o recurso "renda do mês" não existe; o relatório da Tarefa 9 consome o caso de uso e trata ausência como `null`, não o HTTP). `:month` inválido (`2026-13`, `2026-00`, `26-1`, `2026-1`) -> 400 via `ValidationError` do domínio (sem pipe separado). Nenhuma rota pública nova (inventário continua com 5).

### Task 7: Comprovantes e extração

**Files:**
- Create: `src/application/use-cases/receipts/upload-receipt.ts`; `src/infrastructure/storage/local-file-storage.ts`; `src/infrastructure/extraction/{pdf-text-extractor.ts,tesseract-image-extractor.ts,composite-receipt-extractor.ts}`; `prisma-receipt.repository.ts`; controller com multer
- Test: `test/unit/application/receipts/upload-receipt.spec.ts`, `test/integration/extraction/*.spec.ts` (fixtures em `test/fixtures/{comprovante-texto.pdf,comprovante.png,lixo.pdf}`), `test/e2e/receipts.e2e-spec.ts`

**Interfaces:**
- Consumes: `ReceiptExtractor`, `FileStorage`, `Money.parseBRL`.
- Produces: `UploadReceipt.execute(actor, {file: Buffer, mimeType: string, paidAlone: boolean}): Promise<{receiptId: string, suggestedAmountCents: number | null}>`. Se `paidAlone=false` salva o arquivo e NÃO chama o extrator (retorna `suggestedAmountCents: null`). `CompositeReceiptExtractor` escolhe `PdfTextExtractor` (pdf-parse; se o PDF não tiver texto, devolve `amount: null`) ou `TesseractImageExtractor` (idioma `por`) pelo mime. Extração do valor: do texto, localizar o valor após rótulos como "Valor"/"Total" e converter com `Money.parseBRL`.

- [ ] **Step 1:** Testes unitários (fakes): `paidAlone=false` → extrator não chamado (spy); `paidAlone=true` → devolve valor do fake; mime fora de PDF/PNG/JPEG ou magic bytes incompatíveis (checados por uma verificação própria de assinatura) → `ValidationError`; > 5 MB → `ValidationError`; extrator que lança → resposta `suggestedAmountCents: null`, arquivo mantido. Ver falhar.
- [ ] **Step 2:** Implementar `UploadReceipt`; `LocalFileStorage` (grava em `UPLOAD_DIR` com nome `uuid.ext`, impede path traversal). Verde.
- [ ] **Step 3:** Testes de integração dos extratores com fixtures reais (valor conhecido, ex. `R$ 123,45` → 12345; `lixo.pdf` → `null`). Implementar extratores. Verde.
- [ ] **Step 4:** Controller `POST /receipts` (multer em memória com `limits.fileSize`), e2e: PDF-texto devolve valor sugerido; arquivo `.pdf` falso → 422; `paidAlone=false` → `suggestedAmountCents: null`.
- [ ] **Step 5:** Commit `feat: receipt upload and extraction`.

**Decisões e desvios da Tarefa 7, Parte A (implementada; controller/multer/e2e ficam na Parte B):**
- Dependências: ~~`file-type@16`~~ (REMOVIDA na revisão de segurança, ver C2/C3 abaixo). `uuid`/`@types/uuid` removidos (`crypto.randomUUID`). `image-size@1` (CJS) lê só o cabeçalho para o teto de 25 megapixels. OCR usa `@tesseract.js-data/por` (pacote local, `langPath` + `cacheMethod: 'none'`): zero download em runtime. devDependencies: `pdf-lib` e `@napi-rs/canvas` (só o gerador de fixtures `npm run fixtures`, `test/fixtures/generate.ts`; as fixtures geradas estão commitadas).
- `pdf-parse@2` não roda dentro do Jest CJS (o pdf.js carrega o worker com `import()` dinâmico: "needs --experimental-vm-modules"). Solução, que também é uma defesa: o parsing rodava num `worker_threads` descartável (SUBSTITUÍDO por processo filho na revisão de segurança, ver C4/C5 abaixo), com `isEvalSupported: false` e só as 5 primeiras páginas. Falha/crash/PDF inválido -> `amount: null`; só o timeout lança erro.
- OCR (`TesseractImageExtractor`): um worker por chamada, timeout 30 s (worker encerrado; depois reduzido, ver C1), imagem > 25 MP ou ilegível -> `null` sem decodificar, no máximo 2 OCRs simultâneos (o excedente falha rápido com "OCR is busy" e o caso de uso devolve `null`).
- `amountFromText(text, 'native' | 'ocr')` (função pura, `{amount, confidence}`; confiança 0.9 nativo, 0.6 OCR, 0 sem valor). Só sugere quando um rótulo (`valor`, `valor pago/total/do pagamento/da transferência`, `total`, `total pago`, sem acento e sem caixa) é seguido direto de um montante BRL com DUAS casas decimais (`R$ 1.234,56`, `1234,56`; espaços, `:` e até 2 quebras de linha tolerados). `null` quando: sem rótulo, só montantes soltos (saldo, tarifa), rótulos com montantes diferentes (inclusive zero contra real), 3 casas, sem casas, `1234.56`, `1,234.56`, negativo, zero, ou rótulo precedido de letra na mesma linha (`Saldo total R$ ...`, `Pagamento Valor R$ ...`). Não aceita `RS` no lugar de `R$` (prefere `null` a corrigir OCR). Texto truncado em 200 mil caracteres.
- `FileTypeDetector` (porta em `application/ports`, adaptador `MagicBytesFileTypeDetector` em `infrastructure/extraction`). `UploadReceipt` recebe `(storage, receipts, extractor, fileTypes, ids, {extractionTimeoutMs = 45 s})`; extensão gravada: `pdf`/`png`/`jpg`; mime com parâmetros ou fora dos 3 tipos -> `ValidationError`. Extrator que lança/estoura o prazo -> `suggestedAmountCents: null` (arquivo e Receipt mantidos); sugestão <= 0 vira `null`; falha ao salvar o Receipt apaga o arquivo (se o apagar também falhar, o erro original sobe).
- `LocalFileStorage(dir)`: chave só no formato gerado (`<uuid>.<ext>`), qualquer outra -> `ValidationError` antes de tocar o disco; leitura com `O_NOFOLLOW` (symlink recusado), `NotFoundError` se não existe; `delete` idempotente (remove o próprio symlink, nunca o alvo); diretório 0700 e arquivo 0600, flag `wx`. Fiação (ler `UPLOAD_DIR`, instanciar tudo) fica para a Parte B.
- Prisma: `Receipt` (`userId` FK Restrict, `storageKey` UNIQUE, `sizeBytes` INT com CHECK > 0, `suggestedAmountCents` BIGINT com CHECK nulo ou > 0) na migration `20261108200000_receipts`; `Expense.receiptId` ganhou FK `ON DELETE RESTRICT` na migration separada `20261108200100_expense_receipt_fk`, que aborta com erro claro se a coluna já tiver valores (hoje nada a escreve). `migrate diff` contra o banco migrado: zero deriva.
- Os extratores aceitam `extract(buffer)` sem mime (a porta continua `extract(buffer, mimeType)`; o composite roteia por mime e devolve `null` para tipo não suportado).

**Revisão de segurança da Parte A (REPROVADA) e correções C1-C9 (implementadas):**
- **C1 (crítico) imagem corrompida derrubava o processo.** O tesseract.js relança erros de decodificação dentro do callback de mensagem do worker (exceção não capturada). `createWorker` agora recebe `errorHandler: () => undefined`, então o erro só rejeita `recognize()` (tratado: `null`). PNG/JPEG truncados, IHDR válido + lixo e IHDR 10x10 sobre dados de outra imagem dão `null` com o processo vivo; o teste roda o extrator num processo filho e afirma exit 0 e `{cents: null}` (fica vermelho sem a correção). Defesa em profundidade: a assinatura PNG/JPEG é checada ANTES de `image-size`. Limites reduzidos e nomeados: `OCR_TIMEOUT_MS = 10_000`, `MAX_IMAGE_PIXELS = 12_000_000`.
- **C2/C3 (crítico/alto) `file-type@16` removido.** Travava o event loop com ASF malformado (loop infinito síncrono) e lançava `EndOfStreamError` em TIFF/PNG curtos. DECISÃO DO CTO: a dependência saiu do `package.json`, do lockfile e da lista de libs proibidas no eslint. `MagicBytesFileTypeDetector.detect` compara só as 3 assinaturas aceitas (`%PDF-` no offset 0, `89 50 4E 47 0D 0A 1A 0A`, `FF D8 FF`) e devolve `{mime}`/`null`, sem parsear contêiner, sem lançar, sem travar. Outros tipos (GIF, WEBP...) agora são `null` (antes eram "reconhecidos" e rejeitados depois); o caso de uso continua devolvendo `ValidationError`. A porta `FileTypeDetector` não mudou.
- **C4/C5 (alto) PDF sem limite real de memória e vazamento.** O `worker_threads` compartilhava a memória do servidor (typed arrays escapam do cap do heap) e vazava cerca de 7 MB por execução. Agora cada extração é um PROCESSO FILHO descartável (`node -e` com script CJS inline, `--max-old-space-size=192`, ambiente vazio, PDF por stdin, texto por um pipe privado no fd 3; stdout/stderr descartados, então caminhos e stacks nunca chegam a um erro devolvido). O pai amostra o RSS do filho a cada 100 ms com `ps -o rss= -p <pid>` (igual em macOS e Linux) e envia SIGKILL acima de `PDF_MAX_RSS_MB = 512` ou após `PDF_TIMEOUT_MS = 8_000` (o filho também se mata um pouco depois do timeout caso o pai suma). Estouro de memória -> `null`; timeout -> erro 'PDF extraction timed out' (o caso de uso trata como sem sugestão). Semáforo de `PDF_MAX_CONCURRENT = 2`; o 3º falha rápido com 'PDF extraction is busy' (o caso de uso também devolve `null`). Mantidos: 5 primeiras páginas, `isEvalSupported: false`, sem rede. Testes (bombas geradas em tempo de teste): Flate de ~1 MB que expande para 1 GiB e PDF de ~4 MB que declara 4 GiB -> `null`, com crescimento de RSS do pai < 200 MB; 100 execuções seguidas sem crescer o pai (limite generoso de 150 MB, o worker antigo crescia cerca de 700 MB); nenhum filho órfão (`ps`); limite de concorrência.
- **C6 (crítico) `amountFromText` devolvia valor errado com confiança (17 falsos positivos).** Regras novas, todas com teste vermelho antes: (a) depois do montante, na mesma linha, `%`, moeda estrangeira (USD/EUR/US$/€/$), unidades (h, kg, un, itens...), D/C/DB/CR soltos, letra/dígito/`-` colados e rótulo de ajuste logo depois (`R$ 5,00 desconto`) tornam o texto inteiro `null` (quebra de linha e o próximo rótulo não contam); (b) texto com `estorn|cancel|agendad|nao realiz|negad|recus|falh|pendente` (sem acento/caixa) -> `null`; (c) lista negativa `desconto|juros|multa|tarifa|encargo|saldo|limite|parcela|abatimento|mora|iof|taxa|sub-?total|pre-?total` na mesma linha antes do rótulo (inclui o texto do próprio rótulo) ou sozinha numa das 2 linhas acima -> `null`; DESVIO: uma linha acima que já tem montante próprio (`Tarifa: R$ 3,50`) é uma entrada fechada e não veta o rótulo seguinte (senão o teste antigo `Saldo ... / Valor R$ 50,00 / Tarifa ...` deixaria de passar); um rótulo logo depois de outro rótulo (`Valor Total: Valor R$ 5,00`) também -> `null`; (d) com palavra de ajuste no texto (`desconto|abatimento|juros|multa|mora|encargo|acrescimo`) só vale rótulo explicitamente "pago" (`valor pago`, `total pago`, `valor do pagamento`, `valor da transferência`): `Valor R$ 100,00 / Desconto R$ 5,00` -> `null`, `Valor original ... / Valor pago R$ 95,00` -> 9500; (e) rótulos fracos (`Valor`/`Total` sozinhos) exigem `R$` junto do montante (sem `R$` entra só como evidência de conflito; nunca sozinho) e têm confiança menor: nativo 0.9 forte / 0.75 fraco, OCR 0.6 / 0.45; (f) teto `MAX_SUGGESTED_CENTS = 100_000_000` (R$ 1 milhão), acima -> `null`. Princípio: recall perdido é aceitável, valor errado nunca. Linear: no máximo 50 candidatos e janelas de contexto de 300 caracteres (testes de 200 mil caracteres, 20 padrões, < 500 ms cada). Corpus adversarial em `test/unit/infrastructure/amount-corpus.ts` (151 casos reconstruídos do `parser.ts` do revisor + variações; linhas com número podem responder o número ou `null`, `MUST_RECALL` lista as que precisam responder). Duas expectativas do revisor foram corrigidas por decisão do CTO (`Valor original/Valor pago` -> 9500; `Valor Pago 98,00` do boleto -> 9800). Testes antigos ajustados: `Valor: 123,45` (rótulo fraco sem R$) e `Valor: 1.234.567,89` (acima do teto) viraram `null`; o limiar de confiança do PDF de teste caiu de 0.8 para 0.7 (a fixture usa rótulo fraco).
- **C7** `LocalFileStorage.save`: se `writeFile` falhar no meio (ENOSPC), o parcial é apagado (`unlink`, exceto em EEXIST, cujo arquivo é de outro) e o erro original é relançado (mesmo se o `unlink` falhar). **C8** o diretório de uploads já existente é forçado para `0700` (`chmod`) a cada gravação. **C9** `PrismaReceiptRepository.save` não altera `userId` no `update`; salvar um id existente como outro usuário lança `ConflictError` e nada muda (decisão: falhar alto em vez de ignorar em silêncio).
- **Dependências (`npm audit --omit=dev`, depois da remoção do `file-type`):** 6 high. `image-size` (JXL/HEIF/ICNS, loops infinitos; `<=2.0.2`): NÃO alcançável, pois o extrator só chama `image-size` com buffer que começa com a assinatura PNG ou JPEG, e para esses dois a lib usa apenas os parsers de PNG/JPEG (a seleção é pelo primeiro byte: `0x89` png, `0xff` jpg; ICNS é `0x69`); mesmo assim vale subir para a 2.x quando o código for revisitado. `multer` aninhado em `@nestjs/platform-express` (2.4.0, DoS por `fileFilter` assíncrono pendente): fica para a Parte B (ver abaixo). `prisma` / `@prisma/config` / `deepmerge-ts` (esgotamento de pilha ao mesclar grafos recursivos): transitivo da CLI do Prisma, só em tempo de migração/geração, sem entrada de usuário; acompanhar atualização.

**Re-revisão da Parte A (APROVADA) e 4 correções finais (implementadas):**
- **R1 `NOT_PAID` completo.** Também dão `null` (texto inteiro, sem acento/caixa): `devolv`/`devoluc` (Pix devolvido, comprovante de devolução), `reembols`, `expirad`, `nao (foi) realiz|efetiv|conclu` (a negação evita vetar "Pagamento efetivado"), `processamento`, `aguardando`, `analise`, `previst`, `orcamento`, `proposta`, `gerado` (boleto/QR Code gerado). Teste vermelho para cada texto novo e teste de não-regressão: "Pagamento efetivado", "Pix enviado com sucesso", "Transferência concluída" e "Pagamento realizado" continuam sugerindo o valor.
- **R2 Fatura de cartão.** `minimo` entrou na lista de palavras de ajuste: `Fatura / Total R$ 900,00 / Pagamento mínimo [R$ 135,00]` -> `null`.
- **R3 `ps` ausente falhava ABERTO.** Agora o RSS do filho é lido de `/proc/<pid>/status` (VmRSS, Linux) com fallback para `ps -o rss= -p <pid>` (`execFile` com array, sem shell; macOS). Se a leitura falhar (erro, saída vazia ou não numérica) e o filho ainda estiver vivo, ele é morto na hora (SIGKILL) e o caso de uso devolve `null`. Uma falha de leitura de um filho que acabou de sair normalmente é ignorada (espera 50 ms pelo evento de saída). README: imagens Docker enxutas precisam de `procps` (ou `/proc`, que já basta no Linux).
- **R4 Corrida em `PrismaReceiptRepository.save`.** `findUnique`+`upsert` virou `create` com captura de `P2002` na PK (`id`/`Receipt_pkey`; `storageKey` duplicada continua propagando o erro) e, só nesse caso, `updateMany({ where: { id, userId } })` que nunca toca em `userId`; `count === 0` -> `ConflictError`. Teste de integração: 15 rodadas de dois `save` simultâneos do mesmo id por usuários diferentes -> exatamente um sucesso, o outro `ConflictError`, dono e dados do vencedor intactos.
- **Observação para a Parte B:** poliglotas (arquivo que é PDF/PNG/JPEG válido pela assinatura e também outra coisa, ex. HTML/JS) PASSAM na detecção por assinatura, que só olha os primeiros bytes. Por isso a Parte B deve servir o arquivo sempre com `Content-Type` fixo vindo do banco, `nosniff` e `attachment` (requisito abaixo é obrigatório, não opcional).

**Requisitos da Parte B (vindos da revisão de segurança):**
- Servir o arquivo com `Content-Type` fixo vindo do banco (nunca do cliente), `X-Content-Type-Options: nosniff` e `Content-Disposition: attachment`.
- Só o dono lê o comprovante; qualquer outro usuário recebe 404 (não 403, para não revelar existência).
- multer: `limits: { fileSize: 5 MB, files: 1 }`, em memória.
- Rate limit específico (estrito) na rota de upload, além do global.
- Resolver o `multer` aninhado (2.4.0) com `overrides` no `package.json` para `^2.5.0` e conferir com `npm ls multer` (uma única versão) e `npm audit --omit=dev`.
- Erros de detecção/validação do tipo -> 400 (`ValidationError`), nunca 500; erros de extração nunca chegam ao cliente.
- A sugestão do OCR/PDF é só uma sugestão editável: o gasto (Tarefa 8) sempre grava o valor confirmado pelo usuário.

### Task 8: Gastos

**Files:**
- Create: `src/application/use-cases/expenses/{create-expense,update-expense,delete-expense,list-expenses}.ts`, `prisma-expense.repository.ts`, controller/DTOs
- Test: `test/unit/application/expenses/*.spec.ts`, `test/e2e/expenses.e2e-spec.ts`

**Interfaces:**
- Produces: `CreateExpense.execute(actor, {receiptId?, categoryId, amountCents, paidAlone, spentAt, description?}): Promise<{id}>`. `amountCents` é SEMPRE o valor confirmado/informado pelo usuário (obrigatório, > 0); `categoryId` precisa ser visível ao usuário; `receiptId` precisa ser dele. `ListExpenses.execute(actor, {from?, to?, categoryId?})`. Update/Delete só do dono.

- [ ] **Step 1:** Testes: criar com categoria global e com própria; categoria de outro usuário → `NotFoundError`; recibo de outro usuário → `NotFoundError`; `amountCents` ausente/≤0 → `ValidationError` (inclusive `paidAlone=false`); B não lê/edita/exclui gasto de A; filtro por período. Ver falhar.
- [ ] **Step 2:** Implementar, controller, e2e; verde.
- [ ] **Step 3:** Commit `feat: expenses`.

### Task 9: Relatórios

**Files:**
- Create: `src/application/ports/report-repository.ts` (se ainda não existir), `src/application/use-cases/reports/{by-category,by-day,monthly-evolution,income-vs-spent}.ts`, `src/infrastructure/prisma/prisma-report.repository.ts`, controller
- Test: `test/unit/application/reports/*.spec.ts`, `test/integration/prisma-report.repository.spec.ts`, `test/e2e/reports.e2e-spec.ts`

**Interfaces:**
- Produces `ReportRepository`: `totalsByCategory(userId, month)`, `totalsByDay(userId, month)`, `totalsByMonth(userId, fromMonth, toMonth)`, `totalSpent(userId, month)`. Casos de uso retornam:
  - `ByCategory → {categoryId, categoryName, totalCents, percentage}[]`
  - `ByDay → {days: {date, totalCents}[], topDay: {date, totalCents} | null}`
  - `MonthlyEvolution → {month, totalCents}[]` (meses sem gasto = 0)
  - `IncomeVsSpent → {incomeCents: number|null, spentCents, remainingCents: number|null, percentSpent: number|null}`
  Rotas `GET /reports/{by-category,by-day,monthly-evolution,income-vs-spent}?month=YYYY-MM`. Agregação por `GROUP BY` no Postgres.

- [ ] **Step 1:** Testes unitários (repo fake): percentuais somam ~100; `topDay` é o dia de maior total; mês vazio → listas vazias e `topDay: null`; sem salário → `incomeCents: null`.
- [ ] **Step 2:** Testes de integração com gastos de dois usuários: totais de A não incluem B. Implementar repositório Prisma (`groupBy`/`$queryRaw` com parâmetros). Verde.
- [ ] **Step 3:** Controller, e2e dos quatro endpoints; commit `feat: spending reports`.

### Task 10: Endurecimento e fechamento

**Files:**
- Modify: `src/main.ts`, módulos; Create: `test/e2e/authorization-matrix.e2e-spec.ts`, `README.md` (como rodar), `.env.example`

- [ ] **Step 1:** Teste e2e de matriz de autorização: para cada rota protegida, sem token → 401; `N` em rotas de admin → 403; usuário A em recurso de B → 404.
- [ ] **Step 2:** Confirmar CORS restrito por env, limite de body, `app.disable('x-powered-by')`, filtro global sem stack trace; `npm audit --omit=dev` sem vulnerabilidades altas.
- [ ] **Step 3:** Rodar tudo: `npm run lint && npm test && npm run test:integration && npm run test:e2e`; fluxo manual do spec (registrar → ... → quatro relatórios) com curl.
- [ ] **Step 4:** README + commit `chore: hardening and docs`.
