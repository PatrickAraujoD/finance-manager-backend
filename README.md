# finance-manager-backend

## Configuracao

Copie `.env.example` para `.env`. Variaveis obrigatorias: `DATABASE_URL`, `JWT_ACCESS_SECRET`
(min. 32 caracteres), `UPLOAD_DIR`. Opcionais: `PORT`, `CORS_ORIGINS`
(origens separadas por virgula; vazio desliga CORS), `TRUST_PROXY` (`false`, o padrao, ou um
inteiro >= 1; `true` e `0` sao recusados na subida. Atras de proxy reverso use o numero exato de
saltos confiaveis, pois define o IP usado no rate limit),
`THROTTLE_TTL_SECONDS`, `THROTTLE_LIMIT`, `AUTH_THROTTLE_LIMIT` (por IP, padrao 20),
`LOGIN_EMAIL_THROTTLE_LIMIT` (login por IP + e-mail normalizado, padrao 5).

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
