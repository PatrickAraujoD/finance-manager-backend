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
