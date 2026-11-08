# finance-manager-backend

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

`npm test` (unitarios), `npm run test:integration` e `npm run test:e2e` (usam o Postgres do
`docker compose up -d`, banco separado `finance_test`).

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
