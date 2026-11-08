# finance-manager-backend

## Configuracao

Copie `.env.example` para `.env`. Variaveis obrigatorias: `DATABASE_URL`, `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET` (min. 32 caracteres), `UPLOAD_DIR`. Opcionais: `PORT`, `CORS_ORIGINS`
(origens separadas por virgula; vazio desliga CORS), `TRUST_PROXY` (`false`, `true` ou numero de
saltos; so ative atras de proxy confiavel, pois define o IP usado no rate limit),
`THROTTLE_TTL_SECONDS`, `THROTTLE_LIMIT`, `AUTH_THROTTLE_LIMIT`.

## Testes

`npm test` (unitarios), `npm run test:integration` e `npm run test:e2e` (usam o Postgres do
`docker compose up -d`, banco separado `finance_test`).
