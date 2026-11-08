# Finance Manager Backend (MVP) — Design e Plano

## Context
O usuário quer um back-end de gestão financeira pessoal. Cada pessoa informa o salário mensal, sobe comprovantes de pagamento (PDF com texto ou imagem), o sistema extrai o valor, e dados agregados alimentam gráficos de "para onde vai o dinheiro". Requisitos duros: **segurança forte**, **Arquitetura Limpa**, **TDD**, e **NestJS apenas como adaptador** para que trocar de framework seja barato. O repositório está vazio (só README e .gitignore); é greenfield.

## Decisões do usuário
- Arquitetura Limpa + TDD.
- NestJS permitido, mas o código deve ser desacoplado do framework.
- Comprovantes: PDF com texto **e** imagem (OCR).
- Resultado do OCR/extração sempre passa por **confirmação/correção do usuário** antes de salvar.
- Campo "paguei sozinho?": sim → valor extraído (confirmado); não → usuário informa o valor, sem extração.
- Categorias escolhidas pelo usuário; usuário cria as próprias.
- Papéis no campo do usuário: `A` (admin) e `N` (normal). Admin também usa o sistema para os próprios gastos.
- Admin gerencia usuários e categorias globais (valem para todos).
- PostgreSQL, JWT access + refresh, arquivos em disco atrás de uma interface.

## Princípio: biblioteca antes de algoritmo próprio (pedido do usuário)
Sempre que houver biblioteca madura para a funcionalidade, usá-la em vez de escrever o algoritmo. Sempre atrás de uma porta, para manter o desacoplamento. Mapa:
- Dinheiro: `dinero.js` (v2) dentro do value object `Money`, em vez de aritmética própria.
- Datas/meses: `date-fns`.
- IDs: `uuid` (v7) ou `ulid`.
- Senha: `argon2`. JWT: `@nestjs/jwt` + `passport-jwt` (adaptador). Rate limit: `@nestjs/throttler`. Headers: `helmet`.
- Validação: `class-validator` + `class-transformer` nos DTOs; config/env com `@nestjs/config` + `zod`.
- Upload: `multer` (via Nest) + `file-type` para checar magic bytes.
- PDF com texto: `pdf-parse`. OCR: `tesseract.js` (idioma `por`).
- Valor monetário BRL no texto extraído: procurar primeiro uma lib de parsing de moeda/números localizados (ex.: `currency.js`, `numbro`); só escrever regex fina para localizar "Valor/Total" no texto se nenhuma lib resolver.
- Agregações dos gráficos: `GROUP BY` do Postgres via Prisma (`groupBy`/`$queryRaw`), sem somar em memória.
- Testes: `jest`, `supertest`, `@testcontainers/postgresql` (ou o Postgres do Docker Compose).
- Fronteiras de camada: `eslint-plugin-boundaries`.
- Único trecho sem lib pronta: rotação de refresh token com detecção de reuso (regra de negócio, escrita nos casos de uso, usando as libs acima).

## Minhas decisões (sinalizadas, podem ser revistas)
- TypeScript, Jest, npm (pnpm não está instalado), Prisma como ORM (só na camada de infraestrutura), Docker Compose para o Postgres.
- Dinheiro como **inteiro em centavos** (`Money` value object sobre `dinero.js`), nunca float.
- Extração de PDF com `pdf-parse`; OCR com `tesseract.js` (sem dependência de sistema; `tesseract` não está instalado na máquina). Ambos atrás da porta `ReceiptExtractor`.
- Admin **não** enxerga gastos/salário de outros usuários (privacidade). Só gerencia contas e categorias globais.
- Gráficos extras (palpite): comparação gasto vs. salário do mês.

## Non-goals (MVP)
Front-end, integração bancária, multi-moeda, notificações, recuperação de senha por e-mail, exportação.

## Arquitetura (dependências apontam para dentro)
```
src/
  domain/            entidades, value objects (Money, Email, Role), erros de domínio. Zero imports externos.
  application/       casos de uso + portas (interfaces): repositórios, PasswordHasher,
                     TokenService, FileStorage, ReceiptExtractor, Clock, IdGenerator.
  infrastructure/    adaptadores: PrismaXRepository, Argon2Hasher, JwtTokenService,
                     LocalFileStorage, PdfTextExtractor, TesseractImageExtractor, SystemClock.
  presentation/http/ NestJS: controllers, DTOs (class-validator), guards, filtros de erro, módulos.
  main.ts
test/                unit (domain/application, sem Nest), integration (repos com Postgres), e2e (HTTP)
```
Regras: `domain` e `application` não importam `@nestjs/*`, Prisma nem libs de infra. Casos de uso são classes simples recebendo portas pelo construtor; o Nest só faz a fiação (providers com tokens). Lint com `eslint-plugin-boundaries` (ou `import/no-restricted-paths`) para quebrar o build se alguém violar a direção.

## Modelo de dados
- `User`: id, name, email (único), passwordHash, role (`A`|`N`), active, failedLogins, lockedUntil.
- `RefreshToken`: id, userId, tokenHash, familyId, expiresAt, revokedAt (rotação com detecção de reuso).
- `Category`: id, name, ownerId (null = global), único por (ownerId, name).
- `MonthlyIncome`: userId, month (YYYY-MM), amountCents.
- `Receipt`: id, userId, storageKey, mimeType, size, extractedAmountCents?, extractionConfidence?.
- `Expense`: id, userId, categoryId, receiptId?, amountCents, paidAlone, spentAt (data), description?.

## API (resumo)
- Auth: `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`.
- Usuários (admin): `GET /users`, `PATCH /users/:id` (papel/ativo).
- Categorias: `GET /categories` (globais + próprias), `POST/PATCH/DELETE /categories` (próprias; globais só admin).
- Renda: `PUT /income/:month`, `GET /income/:month`.
- Comprovante: `POST /receipts` (multipart, campo `paidAlone`). Se `paidAlone=true` devolve valor sugerido + confiança para o usuário revisar; se `false` só armazena, sem extrair.
- Gastos: `POST /expenses` (receiptId, categoryId, amountCents confirmado/informado, spentAt, paidAlone), `GET/PATCH/DELETE /expenses`.
- Relatórios (todos escopados ao usuário logado, filtro por mês): `GET /reports/by-category`, `/reports/by-day` (inclui dia de maior gasto), `/reports/monthly-evolution`, `/reports/income-vs-spent`.

## Segurança
- Senhas com argon2id; mensagens de login genéricas; bloqueio temporário após N falhas; rate limit (`@nestjs/throttler`, mais restrito em `/auth/*`).
- Access token curto (15 min); refresh rotativo com hash no banco, revogação da família ao detectar reuso.
- Autorização nos **casos de uso** (dono do recurso / papel), não só em guards, para sobreviver à troca de framework.
- Validação de entrada com whitelist (rejeita campos extras); `helmet`, CORS restrito, limite de body.
- Upload: limite de tamanho (5 MB), checagem de **magic bytes** (PDF/PNG/JPEG), nome aleatório, fora de qualquer pasta pública, download só pelo dono.
- Config validada na subida (sem segredos no código; `.env.example`); erros sem stack trace para o cliente; queries parametrizadas via Prisma.

## Ordem de execução (TDD: teste vermelho → verde → refatora)
1. Scaffold: Nest + TS + Jest + ESLint (regras de fronteira) + Docker Compose Postgres + Prisma + `.env.example`.
2. Domínio: `Money`, `Email`, `Role`, entidades (testes primeiro).
3. Auth: register/login/refresh/logout com portas fake nos testes unitários; depois adaptadores reais.
4. Usuários (admin) e Categorias (global/própria).
5. Renda mensal.
6. Extração: `ReceiptExtractor` (parser de valor BRL — "R$ 1.234,56", palavras-chave "Valor"/"Total" — testado com fixtures de PDF-texto e imagem), `FileStorage`, caso de uso de upload com regra `paidAlone`.
7. Gastos (CRUD + regra de confirmação do valor).
8. Relatórios (queries agregadas no repositório, testadas contra Postgres).
9. Endurecimento: throttler, helmet, e2e de autorização (usuário A não acessa dados de B; N não acessa rotas de admin).

## Verificação
- `npm test` (unit, sem banco) e `npm run test:integration` / `test:e2e` (Postgres via `docker compose up -d`).
- Checar que `domain/` e `application/` não importam Nest/Prisma (regra de lint falha o CI).
- Subir a API e exercitar via curl/e2e: registrar → login → criar categoria → definir salário → subir PDF (valor sugerido) → confirmar gasto → subir imagem → gasto dividido (`paidAlone=false` sem extração) → consultar os 4 relatórios.
- Testes negativos: arquivo com tipo falso, token expirado/reutilizado, acesso cruzado entre usuários.
