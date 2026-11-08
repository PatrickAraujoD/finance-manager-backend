# Finance Manager Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** API REST de gestão financeira pessoal: autenticação segura, salário mensal, comprovantes (PDF com texto / imagem) com extração de valor confirmada pelo usuário, gastos categorizados e relatórios para gráficos.

**Architecture:** Arquitetura Limpa em quatro camadas (`domain` ← `application` ← `infrastructure` / `presentation`). Casos de uso são classes TypeScript puras que recebem portas (interfaces) pelo construtor; NestJS só faz a fiação e expõe HTTP. Dinheiro sempre em centavos inteiros.

**Tech Stack:** TypeScript, NestJS (apenas `presentation`), PostgreSQL + Prisma (apenas `infrastructure`), Jest + supertest, argon2, `@nestjs/jwt` + `passport-jwt`, `@nestjs/throttler`, helmet, class-validator, zod, date-fns, uuid, multer + file-type, pdf-parse, tesseract.js, eslint-plugin-boundaries, Docker Compose, npm.

**Spec:** `docs/superpowers/specs/2026-11-08-finance-manager-backend-design.md`

## Global Constraints

- TDD estrito: teste vermelho (rodado e visto falhar) → código mínimo → verde → commit.
- `src/domain` e `src/application` NÃO importam `@nestjs/*`, `@prisma/client` nem libs de infra (argon2, jwt, tesseract, pdf-parse...). Violação quebra o lint.
- Biblioteca madura antes de algoritmo próprio; sempre atrás de uma porta.
- Dinheiro = inteiro em centavos (`Money` próprio sobre inteiro em centavos, sem dependência; decisão do usuário após revisão: dinero.js é ESM-only). Nunca `number` float em regra de negócio.
- Papéis: `'A'` (admin) e `'N'` (normal). Admin NÃO lê gastos/salário de outros usuários.
- Autorização (dono do recurso / papel) é feita nos casos de uso, não só em guards.
- Upload: máx. 5 MB; tipos PDF/PNG/JPEG validados por magic bytes; nome de arquivo aleatório.
- Access token 15 min; refresh token rotativo, guardado só como hash; reuso de refresh revoga a família.
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
- Produces: `GET /health` → `{ status: 'ok' }`; scripts `npm test`, `test:integration`, `test:e2e`, `lint`; Postgres em `localhost:5432` via `docker compose up -d`; `loadConfig(env): AppConfig` em `src/presentation/http/config.ts` (zod; falha na subida se faltar `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `UPLOAD_DIR`).

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
- Produces: `RegisterUser.execute({name,email,password}): Promise<{id}>` (senha mínima 12 chars; role sempre `'N'`; email duplicado → `ConflictError`); `Login.execute({email,password}): Promise<{accessToken, refreshToken}>`; `RefreshSession.execute({refreshToken})` retorna novo par; `Logout.execute({refreshToken})`. Constantes: 5 falhas → bloqueio 15 min. Decorator `@Roles('A')` + `JwtAuthGuard` expõem `req.user = {id, role}`. `DomainErrorFilter` mapeia erros de domínio → 400/401/403/404/409/422 sem stack.

- [ ] **Step 1:** Testes unitários (fakes): register cria usuário `N` com hash (≠ senha); email duplicado em caixa diferente → `ConflictError`; senha curta → `ValidationError`; login ok devolve tokens; senha errada e usuário inexistente lançam o MESMO `UnauthorizedError` (mensagem genérica); 5ª falha bloqueia e login correto durante bloqueio falha; refresh rotaciona (token antigo vira revogado); **reuso de refresh antigo revoga a família** e o novo token também deixa de funcionar; logout revoga.
- [ ] **Step 2:** Rodar e ver falhar; implementar os casos de uso; verde.
- [ ] **Step 3:** Adaptadores: `Argon2Hasher` (argon2id), `JwtTokenService` (access 15 min; refresh = 48 bytes aleatórios via `crypto.randomBytes`, hash SHA-256 salvo), repositórios Prisma + migration (`User`, `RefreshToken`). Teste de integração do repositório contra o Postgres do Compose.
- [ ] **Step 4:** Controller + DTOs (class-validator, whitelist, `forbidNonWhitelisted`), guards, filtro de erros; throttler global e limite mais baixo em `/auth/*`; `helmet`. E2E: registrar → login → rota protegida 200; sem token 401; token expirado 401; 6ª tentativa seguida de login em 1 min → 429.
- [ ] **Step 5:** Commit `feat(auth): register, login, refresh rotation, logout`.

### Task 5: Usuários (admin) e Categorias

**Files:**
- Create: `src/application/use-cases/users/{list-users,update-user}.ts`, `src/application/use-cases/categories/{create-category,update-category,delete-category,list-categories}.ts`; `prisma-category.repository.ts`; controllers/DTOs correspondentes; seed de admin via script `prisma/seed.ts` (lê `ADMIN_EMAIL`/`ADMIN_PASSWORD` do ambiente)
- Test: `test/unit/application/{users,categories}/*.spec.ts`, `test/e2e/{users,categories}.e2e-spec.ts`

**Interfaces:**
- Consumes: ports e guards da Task 4.
- Produces: `ListUsers.execute(actor)` / `UpdateUser.execute(actor, id, {role?, active?})` (só admin; admin não pode se rebaixar nem desativar a si mesmo); `CreateCategory.execute(actor, {name, global?})` (`global` só admin); `ListCategories.execute(actor)` → globais + próprias; `UpdateCategory`/`DeleteCategory(actor, id)`: dono edita a própria, só admin edita global; excluir categoria em uso → `ConflictError`.

- [ ] **Step 1:** Testes unitários: `N` listando usuários → `ForbiddenError`; admin muda papel de outro; admin tentando desativar a si mesmo → erro; `N` criando categoria global → `ForbiddenError`; nome duplicado no mesmo escopo → `ConflictError`; usuário B editando categoria de A → `NotFoundError`; excluir em uso → `ConflictError`. Ver falhar.
- [ ] **Step 2:** Implementar casos de uso e repositório Prisma (unique `(ownerId, name)`; atenção a `NULL` em `ownerId`: índice parcial único para globais, via SQL na migration). Verde.
- [ ] **Step 3:** Controllers, DTOs, e2e (N → 403 em `/users`; categorias globais visíveis a todos).
- [ ] **Step 4:** Commit `feat: user admin and categories`.

### Task 6: Renda mensal

**Files:**
- Create: `src/application/use-cases/income/{set-monthly-income,get-monthly-income}.ts`, `prisma-income.repository.ts`, controller/DTO
- Test: `test/unit/application/income/*.spec.ts`, `test/e2e/income.e2e-spec.ts`

**Interfaces:**
- Produces: `SetMonthlyIncome.execute(actor, {month, amountCents})` (upsert); `GetMonthlyIncome.execute(actor, month): Promise<{month, amountCents} | null>`. Rotas `PUT/GET /income/:month`.

- [ ] **Step 1:** Testes: upsert sobrescreve o mês; valor ≤ 0 → `ValidationError`; mês `2026-13` → erro; usuário só vê o próprio salário. Ver falhar.
- [ ] **Step 2:** Implementar, e2e, verde.
- [ ] **Step 3:** Commit `feat: monthly income`.

### Task 7: Comprovantes e extração

**Files:**
- Create: `src/application/use-cases/receipts/upload-receipt.ts`; `src/infrastructure/storage/local-file-storage.ts`; `src/infrastructure/extraction/{pdf-text-extractor.ts,tesseract-image-extractor.ts,composite-receipt-extractor.ts}`; `prisma-receipt.repository.ts`; controller com multer
- Test: `test/unit/application/receipts/upload-receipt.spec.ts`, `test/integration/extraction/*.spec.ts` (fixtures em `test/fixtures/{comprovante-texto.pdf,comprovante.png,lixo.pdf}`), `test/e2e/receipts.e2e-spec.ts`

**Interfaces:**
- Consumes: `ReceiptExtractor`, `FileStorage`, `Money.parseBRL`.
- Produces: `UploadReceipt.execute(actor, {file: Buffer, mimeType: string, paidAlone: boolean}): Promise<{receiptId: string, suggestedAmountCents: number | null}>`. Se `paidAlone=false` salva o arquivo e NÃO chama o extrator (retorna `suggestedAmountCents: null`). `CompositeReceiptExtractor` escolhe `PdfTextExtractor` (pdf-parse; se o PDF não tiver texto, devolve `amount: null`) ou `TesseractImageExtractor` (idioma `por`) pelo mime. Extração do valor: do texto, localizar o valor após rótulos como "Valor"/"Total" e converter com `Money.parseBRL`.

- [ ] **Step 1:** Testes unitários (fakes): `paidAlone=false` → extrator não chamado (spy); `paidAlone=true` → devolve valor do fake; mime fora de PDF/PNG/JPEG ou magic bytes incompatíveis (checados com `file-type`) → `ValidationError`; > 5 MB → `ValidationError`; extrator que lança → resposta `suggestedAmountCents: null`, arquivo mantido. Ver falhar.
- [ ] **Step 2:** Implementar `UploadReceipt`; `LocalFileStorage` (grava em `UPLOAD_DIR` com nome `uuid.ext`, impede path traversal). Verde.
- [ ] **Step 3:** Testes de integração dos extratores com fixtures reais (valor conhecido, ex. `R$ 123,45` → 12345; `lixo.pdf` → `null`). Implementar extratores. Verde.
- [ ] **Step 4:** Controller `POST /receipts` (multer em memória com `limits.fileSize`), e2e: PDF-texto devolve valor sugerido; arquivo `.pdf` falso → 422; `paidAlone=false` → `suggestedAmountCents: null`.
- [ ] **Step 5:** Commit `feat: receipt upload and extraction`.

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
