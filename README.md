# finance-manager-backend

API REST de gestao financeira pessoal: cadastro e login seguros, salario mensal, comprovantes
(PDF com texto ou imagem) com valor sugerido por extracao e SEMPRE confirmado pelo usuario,
gastos por categoria e quatro relatorios para graficos. Os papeis sao `A` (admin) e `N` (normal);
o admin gerencia usuarios e categorias globais, mas nao le gastos nem salario de ninguem.

## Arquitetura

Arquitetura Limpa em quatro camadas; as setas mostram quem pode importar quem (o lint
`eslint-plugin-boundaries` quebra o build se uma camada interna importar uma externa).

```
  presentation (NestJS: controllers, guards, DTOs, filtro de erros)  --+
  infrastructure (Prisma/Postgres, argon2, JWT, PDF, OCR, disco)      --+--> application --> domain
                                                                           (casos de uso +    (Money, Email,
                                                                            portas/interfaces)  entidades, erros)
```

- `src/domain`: regras puras (`Money` em centavos, `CalendarDate`, validacao de texto, entidades).
- `src/application`: casos de uso (classes TS puras) e as portas (`*Repository`, `TokenService`,
  `ReceiptExtractor`, `FileStorage`...). Autorizacao por dono/papel acontece aqui.
- `src/infrastructure`: implementacoes das portas. `src/presentation/http`: HTTP e fiacao do Nest.

## Como rodar

```
cp .env.example .env            # edite JWT_ACCESS_SECRET (openssl rand -base64 48) e o admin
docker compose up -d            # Postgres 16 em localhost:5432 (finance/finance)
npm ci
npx prisma migrate deploy       # aplica as migrations (use `npx prisma migrate dev` ao evoluir o schema)
ADMIN_EMAIL=... ADMIN_PASSWORD='...' npm run seed   # primeiro admin (ver "Primeiro admin")
npm run start:dev               # API em http://localhost:3000 (ou `npm run build && npm start`)
```

Testes (precisam do Postgres do compose; usam um banco `*_test` separado, criado e migrado
sozinho; `TEST_DATABASE_URL` troca o banco, e o nome TEM de terminar em `_test`):

```
npm run lint && npm test            # unitarios (sem banco), incluindo fronteiras e commits
npm run test:integration            # repositorios Prisma, extracao real de PDF/OCR, seed
npm run test:e2e                    # HTTP completo, matriz de autorizacao e jornada do usuario
node scripts/check-secrets.js       # falha se um .env ou segredo obvio estiver versionado
```

## Endpoints

Tudo e privado (Bearer access token, 15 min) a menos que a coluna Papel diga `publico`. Erros
tem sempre o formato `{statusCode, error, message}`; recursos de outro usuario respondem 404
identico ao inexistente.

| Metodo | Rota | Papel | Descricao |
|---|---|---|---|
| GET | `/health` | publico | Liveness |
| POST | `/auth/register` | publico | Cria usuario normal (`name`, `email`, `password`) |
| POST | `/auth/login` | publico | Devolve `accessToken` e `refreshToken` |
| POST | `/auth/refresh` | publico | Rotaciona o refresh token (reuso revoga a familia) |
| POST | `/auth/logout` | publico | Revoga a sessao do refresh token (idempotente) |
| GET | `/auth/me` | N, A | Perfil do usuario autenticado |
| GET | `/users` | A | Lista usuarios |
| PATCH | `/users/:id` | A | Muda `role` e/ou `active` (desativar encerra as sessoes) |
| GET | `/categories` | N, A | Categorias globais e proprias |
| POST | `/categories` | N, A | Cria categoria propria; `global: true` so admin |
| PATCH | `/categories/:id` | N, A | Renomeia a propria (global so admin) |
| DELETE | `/categories/:id` | N, A | Exclui; 409 se houver gastos nela |
| PUT | `/income/:month` | N, A | Define o salario do mes (`YYYY-MM`, centavos) |
| GET | `/income/:month` | N, A | Le o salario do mes (404 se nao cadastrado) |
| POST | `/receipts` | N, A | Upload multipart (PDF/PNG/JPEG, 5 MiB); devolve valor sugerido |
| GET | `/receipts/:id/file` | N, A | Baixa o proprio comprovante |
| POST | `/expenses` | N, A | Cria gasto com o valor confirmado pelo usuario |
| GET | `/expenses` | N, A | Lista paginada com filtros `from`, `to`, `categoryId` |
| GET | `/expenses/:id` | N, A | Le um gasto proprio |
| PATCH | `/expenses/:id` | N, A | Altera um gasto proprio |
| DELETE | `/expenses/:id` | N, A | Exclui um gasto proprio |
| GET | `/reports/by-category` | N, A | Para onde vai o dinheiro (percentuais somam 100) |
| GET | `/reports/by-day` | N, A | Total por dia e `topDay` |
| GET | `/reports/monthly-evolution` | N, A | Evolucao mensal (ate 24 meses) |
| GET | `/reports/income-vs-spent` | N, A | Salario x gasto do mes |

Os detalhes de cada grupo estao nas secoes Comprovantes, Gastos e Relatorios abaixo. Um teste
e2e (`authorization-matrix`) lista as rotas registradas e quebra se uma rota nova nao for
declarada na matriz, o que obriga a decidir o papel e o isolamento de cada rota.

## Variaveis de ambiente

Resumo (valores e exemplos em `.env.example`; detalhes na secao Configuracao):

| Variavel | Obrigatoria | Para que serve |
|---|---|---|
| `DATABASE_URL` | sim | Postgres da aplicacao |
| `JWT_ACCESS_SECRET` | sim | Segredo do access token (min. 32 caracteres) |
| `UPLOAD_DIR` | sim | Diretorio privado dos comprovantes (0700) |
| `PORT` | nao | Porta HTTP (3000) |
| `CORS_ORIGINS` | nao | Origens permitidas, separadas por virgula; vazio desliga CORS |
| `TRUST_PROXY` | nao | `false` ou numero exato de saltos de proxy (>= 1) |
| `THROTTLE_*`, `AUTH_THROTTLE_LIMIT`, `LOGIN_EMAIL_THROTTLE_LIMIT`, `UPLOAD_THROTTLE_LIMIT` | nao | Rate limits |
| `REQUEST_TIMEOUT_MS`, `HEADERS_TIMEOUT_MS`, `KEEP_ALIVE_TIMEOUT_MS` | nao | Timeouts do servidor |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | so no seed | Primeiro admin |
| `TEST_DATABASE_URL` | so nos testes | Banco de testes (nome termina em `_test`) |

## Configuracao

Copie `.env.example` para `.env`. Variaveis obrigatorias: `DATABASE_URL`, `JWT_ACCESS_SECRET`
(min. 32 caracteres), `UPLOAD_DIR`. Opcionais: `PORT`, `CORS_ORIGINS`
(origens separadas por virgula; vazio desliga CORS), `TRUST_PROXY` (`false`, o padrao, ou um
inteiro >= 1; `true` e `0` sao recusados na subida. Atras de proxy reverso use o numero exato de
saltos confiaveis, pois define o IP usado no rate limit),
`THROTTLE_TTL_SECONDS`, `THROTTLE_LIMIT`, `AUTH_THROTTLE_LIMIT` (por IP, padrao 20),
`LOGIN_EMAIL_THROTTLE_LIMIT` (login por IP + e-mail normalizado, padrao 5),
`UPLOAD_THROTTLE_LIMIT` (uploads de comprovante por usuario autenticado na janela, padrao 10;
sem token valido a chave e o IP). Timeouts do servidor HTTP em milissegundos, com limites
sensatos (valores absurdos derrubam a subida): `REQUEST_TIMEOUT_MS` (requisicao inteira, padrao
60000, 1000 a 600000), `HEADERS_TIMEOUT_MS` (cabecalhos, padrao 20000, 1000 a 120000, nao pode
passar de `REQUEST_TIMEOUT_MS`) e `KEEP_ALIVE_TIMEOUT_MS` (conexao ociosa, padrao 5000, 1000 a
120000). Um cliente que abre a conexao e fica parado (slowloris) e desconectado dentro desses
limites; um upload abortado pelo cliente e registrado como aviso curto, nao como erro.

## Comprovantes

`POST /receipts` (multipart/form-data): campo de arquivo `file` (PDF, PNG ou JPEG, ate 5 MiB) e
campo de texto `paidAlone` (`true` ou `false`, nada mais). Responde 201 com
`{receiptId, suggestedAmountCents}`; o valor e so uma sugestao (inteiro ou `null`). O arquivo e
guardado em `UPLOAD_DIR` (diretorio privado, 0700) com nome gerado; o nome enviado pelo cliente
nunca e usado. `GET /receipts/:id/file` so entrega ao dono (qualquer outro caso, admin incluso, e
um 404 identico), com `Content-Type` vindo do banco, `nosniff`, `attachment` e `no-store`.

## Gastos

Todas as rotas exigem token e trabalham so com os gastos do proprio usuario (admin nao ve os de
outros; gasto alheio e um 404 identico ao inexistente).

- `POST /expenses` -> 201 `{id}`. Corpo: `categoryId` (UUID de categoria global ou propria),
  `amountCents` (inteiro de 1 a 1000000000, SEMPRE o valor que o usuario confirmou, mesmo com
  comprovante e mesmo com `paidAlone=false`), `paidAlone` (booleano), `spentAt` (`YYYY-MM-DD`,
  data real, no maximo hoje + 1 dia em UTC), `receiptId` (opcional, UUID de comprovante proprio;
  cada comprovante so pode ser usado por um gasto, senao 409) e `description` (opcional, ate 500
  caracteres). Sem `receiptId` e um lancamento manual. Categoria ou comprovante de outro usuario
  -> 404. Campos extras (`userId`, `id`, `createdAt`...) -> 400.
- `GET /expenses?from=&to=&categoryId=&limit=&offset=` -> 200 `{items, total, limit, offset}`.
  `from`/`to` inclusivos (`YYYY-MM-DD`, `from <= to`), `limit` 1 a 200 (padrao 100), `offset` 0 a
  100000. Ordem: `spentAt` e `id` decrescentes.
- `GET /expenses/:id`, `PATCH /expenses/:id` (parcial, ao menos um de `categoryId`, `amountCents`,
  `spentAt`, `description`, `paidAlone`; `receiptId` e `userId` nao mudam e dao 400) e
  `DELETE /expenses/:id` (204; o comprovante e o arquivo ficam, e o comprovante volta a poder ser
  usado).
- Resposta de um gasto: `id, categoryId, receiptId, amountCents, paidAlone, spentAt, description,
  createdAt`. Excluir uma categoria usada por gastos responde 409 e nao apaga nada.

## Relatorios

Quatro rotas `GET`, todas privadas (token obrigatorio, throttle global) e escopadas ao proprio
usuario: nao ha id de usuario na requisicao e o admin so ve os proprios dados. A query e estrita:
mes ausente, formato diferente de `YYYY-MM`, ano fora de 1900 a 9998 (vale tambem para
`PUT/GET /income/:month`), parametro repetido ou desconhecido -> 400. Valores em
centavos sao inteiros JSON. Os meses/dias seguem o calendario UTC (`spentAt` e uma data).

- `GET /reports/by-category?month=2026-11` ("para onde vai o dinheiro"): categorias ordenadas por
  total decrescente (desempate por nome e id). `percentage` tem 2 casas e a soma e exatamente 100
  (metodo do maior resto, em inteiros). Mes sem gastos: `items: []`, `totalCents: 0`.

  ```json
  {"month":"2026-11","totalCents":300,"items":[
    {"categoryId":"…","categoryName":"Alimentacao","totalCents":200,"percentage":66.67},
    {"categoryId":"…","categoryName":"Casa","totalCents":100,"percentage":33.33}]}
  ```

- `GET /reports/by-day?month=2026-11` ("qual dia gastou mais"): so dias com gasto, por data
  crescente; `topDay` e o dia de maior total (empate: data mais antiga). Mes vazio: `days: []`,
  `topDay: null`.

  ```json
  {"month":"2026-11","days":[{"date":"2026-11-02","totalCents":200},
    {"date":"2026-11-10","totalCents":450}],"topDay":{"date":"2026-11-10","totalCents":450}}
  ```

- `GET /reports/monthly-evolution?from=2025-11&to=2026-02`: todos os meses do intervalo, com 0 nos
  meses sem gasto. `from <= to` e no maximo 24 meses (senao 400).

  ```json
  {"from":"2025-11","to":"2026-02","months":[{"month":"2025-11","totalCents":10},
    {"month":"2025-12","totalCents":0},{"month":"2026-01","totalCents":40},
    {"month":"2026-02","totalCents":0}]}
  ```

- `GET /reports/income-vs-spent?month=2026-11`: sem salario cadastrado, `incomeCents`,
  `remainingCents` e `percentSpent` sao `null`; `remainingCents` pode ser negativo e
  `percentSpent` pode passar de 100 (2 casas, calculado com inteiros).

  ```json
  {"month":"2026-11","incomeCents":500000,"spentCents":125000,"remainingCents":375000,
   "percentSpent":25}
  ```

Os totais vem de `GROUP BY` no Postgres (uma consulta por relatorio, usando o indice
`(userId, spentAt)`); uma soma fora do inteiro seguro vira erro 500, nunca um numero arredondado.

## Primeiro admin

Registro publico sempre cria usuarios normais. O primeiro admin vem do seed, que le
`ADMIN_EMAIL` e `ADMIN_PASSWORD` do ambiente (senha de 12 a 128 caracteres, mesma regra do
registro) e `DATABASE_URL`:

```
ADMIN_EMAIL=voce@exemplo.com ADMIN_PASSWORD='...' npm run seed
```

O seed e idempotente: se ja existir uma conta com esse e-mail, nada e alterado (a senha de um
admin existente nunca e sobrescrita) e a senha nunca e impressa. Se a conta existente nao for um admin ativo (usuario normal ou admin
inativo), o seed avisa "Account exists but is not an active admin; promote it manually" e termina
com codigo 1: ele nunca promove ninguem sozinho. Depois, o admin gerencia papeis e
ativacao em `GET /users` e `PATCH /users/:id`.

## Testes

Ver "Como rodar". Os e2e usam o Postgres do `docker compose up -d` e um banco separado
(`finance_test` por padrao, ou `TEST_DATABASE_URL`).

## Imagens Docker

A extracao de PDF roda num processo filho cuja memoria (RSS) o servidor vigia. No Linux ele le
`/proc/<pid>/status`; onde isso nao existir (macOS) usa `ps`, que imagens enxutas (por exemplo
`node:*-slim`) podem nao trazer: instale `procps`. Se o RSS nao puder ser lido, o filho e morto
na hora e o comprovante fica sem valor sugerido (falha fechada), nunca sem limite.

## Texto aceito

Campos de texto rejeitam (400) as categorias Unicode `Cc` (controles), `Cf` (invisiveis e
bidirecionais, como U+200B e U+202E), `Zl` e `Zp` (U+2028/2029) e surrogates soltos. Excecoes por
campo: nomes (usuario, categoria) e descricao aceitam U+200D (emojis compostos) e espacos Unicode
visiveis; a descricao ainda aceita TAB e LF; o e-mail nao aceita nenhum espaco Unicode nem excecao;
a senha de cadastro so recusa controles C0/C1/DEL, NUL e surrogates soltos. No login a senha e o
refresh token sao opacos (so tamanho), para contas antigas continuarem entrando.

## Seguranca

Modelo resumido:

- **Guard global fail-closed**: `JwtAuthGuard` e `RolesGuard` sao `APP_GUARD`; toda rota e privada
  a menos que tenha `@Public()` (so as cinco publicas da tabela). O guard rele o usuario no banco:
  conta desativada ou removida perde acesso na hora, e o papel vem do banco, nao do token.
- **Senhas e tokens**: argon2; access token JWT de 15 min; refresh token rotativo guardado so como
  hash, com revogacao da familia inteira se um token ja usado reaparecer.
- **Isolamento**: autorizacao nos casos de uso; recurso de outro usuario e 404 identico ao
  inexistente (corpo e cabecalhos), inclusive para o admin, que nao ve gastos nem salario alheios.
- **Entrada**: DTOs com whitelist e `forbidNonWhitelisted`, texto sem NUL, controles e surrogates
  soltos, corpo JSON ate 100 kb (413), upload ate 5 MiB validado por magic bytes, SQL sempre
  parametrizado.
- **Respostas**: `helmet`, sem `x-powered-by`, CORS so para as origens de `CORS_ORIGINS`, sem
  `ETag`/304 e `Cache-Control: no-store` em toda resposta, filtro global de erros sem stack,
  caminho nem SQL. Os logs nao recebem senha, token, hash, e-mail nem descricao de gasto (um
  teste captura os logs da jornada completa e confere).
- **Abuso**: rate limit global, por IP nas rotas de auth, por IP + e-mail no login e por usuario no
  upload; timeouts do servidor; `TRUST_PROXY` estrito.
- **Segredos fora do git**: `.env*` ignorado (exceto `.env.example`); `node scripts/check-secrets.js`
  (e um teste unitario) falha se um `.env` ou um padrao obvio de segredo estiver versionado. O
  historico inteiro foi varrido em 2026-11-08 e so tem placeholders e dados de teste.

### Auditoria de dependencias (`npm audit --omit=dev`, 2026-11-08)

Resultado: 4 advisories altos, todos aceitos de forma consciente, sem atualizar majors (o gate
`scripts/audit-gate.js` falha para qualquer advisory novo ou aceitacao vencida):

| Pacote | Advisory | Motivo da aceitacao |
|---|---|---|
| `image-size` 1.x | GHSA-5p2g-fcmc-qvqq (JXL/HEIF), GHSA-w3rx-r6r6-pgpr (ICNS) | Loop infinito em formatos que a API nunca aceita: so PDF/PNG/JPEG passam pela checagem de assinatura e o `image-size` le apenas o cabecalho de PNG/JPEG. Codigo vulneravel inalcancavel. Corrigir exige a major 2.x. |
| `deepmerge-ts` via `@prisma/config` / `prisma` (CLI) | GHSA-ggr8-5vv4-36mx | Esgotamento de pilha so no Prisma CLI, em build/migrate, com configuracao nossa; nao roda no servidor. Corrigir exige Prisma 7 (major). |

Reavaliar ate 2027-02-08 (prazo registrado no gate).

## Decisoes principais

- **`Money` proprio** sobre inteiro em centavos, sem dependencia (dinero.js e so ESM); nunca float
  em regra de negocio; tetos tambem no banco (`CHECK`).
- **PDF em processo filho** com RSS vigiado e tempo limite: um PDF hostil nao derruba nem estoura a
  memoria da API; falha fechada, sem valor sugerido.
- **OCR so sugere**: o valor extraido (PDF ou imagem) e uma sugestao; o gasto guarda sempre o
  valor que o usuario confirmou. Com `paidAlone=false` o extrator nunca e chamado.
- **Guard global fail-closed**: rotas novas nascem privadas; um e2e trava o conjunto de rotas
  publicas e a matriz de autorizacao.
- **`spentAt` e uma DATA de calendario** (DATE, 00:00 UTC): sem deslocamento de fuso; agrupamentos
  por dia/mes em UTC.
- **Percentuais exatos**: maior resto em inteiros (BigInt), somando exatamente 100.
- **Relatorios por `GROUP BY` no Postgres**, uma consulta cada, com o indice `(userId, spentAt)`.

## Limites conhecidos e proximos passos

- Sem recuperacao de senha, verificacao de e-mail nem MFA.
- Rate limit em memoria (por instancia): com varias replicas, mover para um store compartilhado.
- Comprovantes ficam em disco local; para varias instancias, trocar a porta `FileStorage` por
  objeto/S3. Sem varredura de antivirus.
- OCR so em portugues e sem PDF escaneado (PDF sem texto devolve sugestao `null`).
- Uma unica moeda (BRL) e um unico salario por mes; gastos sem recorrencia nem anexo multiplo.
- Logs de texto simples; falta correlacao por requisicao, metricas e tracing.
- As dependencias aceitas na auditoria devem ser revistas na proxima janela de upgrade
  (Prisma 7, `image-size` 2).
