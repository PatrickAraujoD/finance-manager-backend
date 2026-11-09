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
cp .env.example .env            # preencha JWT_ACCESS_SECRET (openssl rand -base64 48) e o admin
docker compose up -d            # Postgres 16 em localhost:5432 (finance/finance)
npm ci
npx prisma migrate deploy       # aplica as migrations (use `npx prisma migrate dev` ao evoluir o schema)
npm run seed                    # primeiro admin, de ADMIN_EMAIL/ADMIN_PASSWORD do .env (ver "Primeiro admin")
npm run start:dev               # API em http://localhost:3000 (ou `npm run build && npm start`)
```

Requer Node >= 22.9 (`engines`). `npm start`, `npm run start:dev`, `npm run start:prod` e
`npm run seed` carregam o `.env` com o suporte nativo do Node (`node --env-file-if-exists=.env`):
se o arquivo nao existir, nada quebra (o Node so avisa) e a validacao de configuracao diz o que
falta. **Variaveis ja definidas no ambiente nunca sao sobrescritas pelo `.env`** (o ambiente
vence; ha um teste de integracao para isso). A imagem Docker nao usa `.env`: o `CMD` e
`node dist/main.js` e a configuracao vem das variaveis do container. Para outros comandos
(por exemplo `npx prisma ...`, que ja le o `.env` sozinho, ou um script seu), exporte o arquivo no
shell:

```
set -a; . ./.env; set +a
```

O `JWT_ACCESS_SECRET` nao tem valor padrao: a API recusa subir com um valor de exemplo (que
contenha `troque-por`, `change-me`, `placeholder`...), menor que 32 caracteres ou com menos de 10
caracteres distintos. A mensagem de erro nunca imprime o segredo.

Testes (precisam do Postgres do compose; usam um banco `*_test` separado, criado e migrado
sozinho; `TEST_DATABASE_URL` troca o banco, e o nome TEM de terminar em `_test`):

```
npm run lint && npm test            # unitarios (sem banco), incluindo fronteiras e commits
npm run test:integration            # repositorios Prisma, extracao real de PDF/OCR, seed
npm run test:e2e                    # HTTP completo, matriz de autorizacao e jornada do usuario
node scripts/check-secrets.js       # falha se um .env ou segredo obvio estiver versionado
```

## Endpoints

A API tem 33 rotas, todas em JSON (exceto o upload `multipart/form-data` e o download do
comprovante). Esta secao e a referencia completa: o que cada rota faz, o que ela recebe e o que
devolve.

### Regras que valem para todas as rotas

- **Autenticacao.** Todas as rotas sao privadas e exigem `Authorization: Bearer <accessToken>`,
  exceto as cinco marcadas como `publico` (`/health` e quatro de `/auth`). O access token vale 15
  minutos; renove-o com `POST /auth/refresh`. Uma rota nova nasce privada (guard global); um teste
  e2e (`authorization-matrix`) lista as rotas registradas e quebra se alguma nao for declarada.
- **Papeis.** `N` (usuario normal) e `A` (admin). O admin tambem usa o sistema para os proprios
  gastos, mas **nao le gastos, comprovantes nem salario de outros usuarios**: ele so gerencia
  contas (`/users`) e categorias globais.
- **Dono do dado.** Nao existe id de usuario nas rotas. O dono vem sempre do token. Um recurso de
  outro usuario (gasto, comprovante, categoria privada) responde **404 identico** ao de um recurso
  inexistente, para nao revelar o que existe.
- **Dinheiro.** Sempre em **centavos, como numero inteiro** (`1234` = R$ 12,34), nunca decimal.
- **Datas e meses.** Datas no formato `YYYY-MM-DD` e meses em `YYYY-MM`, no calendario UTC; o ano
  vai de 1900 a 9998.
- **Corpo estrito.** Campos que nao existem na rota sao recusados com 400 (nada de `userId`, `role`
  ou `id` "de contrabando").
- **Erros.** Sempre `{"statusCode": 400, "error": "Bad Request", "message": ...}`, sem stack nem
  detalhes internos. Codigos: 400 entrada invalida, 401 sem sessao valida, 403 sem permissao,
  404 nao encontrado, 409 conflito, 413 corpo grande demais, 429 limite de requisicoes.
- **Respostas** saem com `Cache-Control: no-store` e sem `ETag`.

### Indice

| Metodo | Rota | Acesso | Para que serve |
|---|---|---|---|
| GET | `/health` | publico | Saber se a API esta no ar |
| POST | `/auth/register` | publico | Criar uma conta de usuario normal |
| POST | `/auth/login` | publico | Entrar e receber os tokens |
| POST | `/auth/refresh` | publico | Trocar o refresh token por um par novo |
| POST | `/auth/logout` | publico | Encerrar a sessao |
| GET | `/auth/me` | N, A | Ver o proprio perfil |
| GET | `/users` | A | Listar os usuarios do sistema |
| PATCH | `/users/:id` | A | Mudar papel ou ativar/desativar um usuario |
| GET | `/categories` | N, A | Listar categorias (globais + proprias) |
| POST | `/categories` | N, A | Criar categoria propria (ou global, se admin) |
| PATCH | `/categories/:id` | N, A | Renomear uma categoria |
| DELETE | `/categories/:id` | N, A | Excluir uma categoria sem gastos |
| PUT | `/income/:month` | N, A | Informar o salario do mes |
| GET | `/income/:month` | N, A | Consultar o salario do mes |
| POST | `/receipts` | N, A | Enviar um comprovante e receber o valor sugerido |
| GET | `/receipts/:id/file` | N, A | Baixar um comprovante proprio |
| POST | `/expenses` | N, A | Registrar um gasto |
| GET | `/expenses` | N, A | Listar gastos com filtros e paginacao |
| GET | `/expenses/:id` | N, A | Ver um gasto |
| PATCH | `/expenses/:id` | N, A | Corrigir um gasto |
| DELETE | `/expenses/:id` | N, A | Excluir um gasto |
| POST | `/loans` | N, A | Registrar um emprestimo (de um gasto ou em dinheiro) |
| GET | `/loans` | N, A | Listar emprestimos com filtros e paginacao |
| GET | `/loans/summary` | N, A | Resumo por pessoa: quanto deve, a vencer, atrasado e ja pago |
| GET | `/loans/:id` | N, A | Ver um emprestimo com pago, saldo e situacao |
| PATCH | `/loans/:id` | N, A | Corrigir o nome ou o vencimento |
| DELETE | `/loans/:id` | N, A | Excluir um emprestimo (409 se tiver pagamentos) |
| POST | `/loans/:id/payments` | N, A | Registrar um pagamento (dinheiro ou Pix com comprovante) |
| GET | `/loans/:id/payments` | N, A | Listar os pagamentos de um emprestimo |
| GET | `/reports/by-category` | N, A | Grafico: para onde vai o dinheiro |
| GET | `/reports/by-day` | N, A | Grafico: gasto por dia e dia de maior gasto |
| GET | `/reports/monthly-evolution` | N, A | Grafico: evolucao mes a mes |
| GET | `/reports/income-vs-spent` | N, A | Quanto do salario ja foi gasto |

### Saude

**`GET /health`** (publico). Responde `200 {"status":"ok"}`. Serve para monitoramento e para o
`HEALTHCHECK` do Docker. Nao toca no banco.

### Autenticacao (`/auth`)

Fluxo tipico: `register` -> `login` -> usar o `accessToken` -> quando expirar, `refresh` -> ao sair,
`logout`.

**`POST /auth/register`** (publico). Cria uma conta de usuario normal (`N`). Nunca cria admin: o
primeiro admin vem do seed (ver "Primeiro admin").
- Corpo: `name` (1 a 100 caracteres), `email` (valido, ate 254), `password` (12 a 128 caracteres).
- Resposta: `201 {"id": "<uuid>"}`.
- Erros: `400` dados invalidos ou campo extra (como `role`); `409` e-mail ja cadastrado (maiusculas
  e minusculas, NFC/NFD, formas de largura total e dominio IDN/punycode contam como o mesmo
  e-mail); `429` muitas tentativas.

**`POST /auth/login`** (publico). Autentica e devolve os dois tokens.
- Corpo: `email`, `password`.
- Resposta: `200 {"accessToken": "...", "refreshToken": "..."}`. O access token vale 15 minutos; o
  refresh token e opaco e vale 7 dias.
- Erros: `401` com **a mesma resposta** para e-mail inexistente, senha errada, conta desativada ou
  conta bloqueada (ninguem descobre quais e-mails existem). Apos 5 senhas erradas a conta fica
  bloqueada por 15 minutos. `429` por limite de tentativas (por IP, e por IP + e-mail).

**`POST /auth/refresh`** (publico). Troca um refresh token por um par novo. O token antigo morre
(rotacao).
- Corpo: `refreshToken`.
- Resposta: `200 {"accessToken": "...", "refreshToken": "..."}`.
- Erros: `401` token invalido, expirado ou de usuario desativado. Se um token **ja usado** for
  reapresentado, a sessao inteira e revogada (sinal de roubo de token).

**`POST /auth/logout`** (publico). Encerra a sessao do refresh token informado.
- Corpo: `refreshToken`.
- Resposta: `204` sem corpo. E idempotente: um token desconhecido tambem responde `204`.

**`GET /auth/me`** (N, A). Devolve o perfil de quem esta autenticado.
- Resposta: `200 {"id", "name", "email", "role"}` (`role` e `"N"` ou `"A"`).

### Usuarios (`/users`, so admin)

Para o admin cuidar das contas. Usuario normal recebe `403`.

**`GET /users`**. Lista os usuarios (ate 500, do mais antigo ao mais novo).
- Resposta: `200 [{"id","name","email","role","active","createdAt"}]`. O hash da senha nunca sai.

**`PATCH /users/:id`**. Muda o papel e/ou a situacao de um usuario.
- Corpo: `role` (`"A"` ou `"N"`) e/ou `active` (booleano); ao menos um.
- Resposta: `200` com o usuario atualizado (mesmo formato da lista).
- Efeitos: **desativar** (`active: false`) derruba na hora todas as sessoes do usuario, mesmo que o
  access token ainda nao tenha expirado.
- Erros: `403` se o admin tentar rebaixar ou desativar a si mesmo; `409` se a mudanca deixaria o
  sistema sem nenhum admin ativo; `404` usuario inexistente; `400` id invalido ou campo extra.

### Categorias (`/categories`)

Categorias classificam os gastos. Ha dois tipos: **globais** (criadas pelo admin, valem para todos)
e **proprias** (de cada usuario, invisiveis para os outros).

**`GET /categories`**. Lista as categorias que o usuario pode usar (globais + as proprias).
- Resposta: `200 [{"id","name","global"}]`.

**`POST /categories`**. Cria uma categoria.
- Corpo: `name` (ate 60 caracteres) e, opcionalmente, `global: true` (so admin).
- Resposta: `201 {"id": "<uuid>"}`.
- Regras: o nome nao pode repetir no mesmo escopo, sem diferenciar maiusculas, acentos
  compostos/decompostos ou espacos repetidos. Cada usuario pode ter no maximo 100 categorias
  proprias.
- Erros: `403` usuario normal pedindo `global: true`; `409` nome repetido ou limite de 100;
  `400` dados invalidos.

**`PATCH /categories/:id`**. Renomeia uma categoria.
- Corpo: `name`.
- Resposta: `200 {"id","name","global"}`.
- Quem pode: o dono renomeia a propria; so admin renomeia uma global. Categoria privada de outro
  usuario responde `404`, inclusive para o admin. Nao e possivel transformar uma categoria
  privada em global nem mudar o dono. Renomear uma global vale para todos.

**`DELETE /categories/:id`**. Exclui uma categoria.
- Resposta: `204`.
- Erros: `409` se ainda houver gastos usando a categoria (nada e apagado); `403` usuario normal
  tentando excluir uma global; `404` nao encontrada ou de outro usuario.

### Salario (`/income`)

O salario do mes e a base do relatorio `income-vs-spent`. Cada usuario tem o seu, por mes.

**`PUT /income/:month`**. Define (ou substitui) o salario de um mes. `:month` no formato `YYYY-MM`.
- Corpo: `amountCents` (inteiro de 1 a 100000000000, em centavos).
- Resposta: `200 {"month": "2026-11", "amountCents": 500000}`.
- Erros: `400` mes invalido (`2026-13`, `2026-1`, ano fora de 1900 a 9998), valor zero, negativo,
  decimal ou campo extra.

**`GET /income/:month`**. Consulta o salario de um mes.
- Resposta: `200 {"month","amountCents"}`; `404` se o mes nao tem salario cadastrado.

### Comprovantes (`/receipts`)

O usuario envia o comprovante de pagamento (PDF com texto ou imagem). O sistema **sugere** o valor
lido do arquivo, e **o usuario sempre confirma ou corrige** ao criar o gasto: o valor sugerido
nunca e salvo sozinho.

**`POST /receipts`**. Recebe o arquivo e, se o usuario pagou sozinho, tenta ler o valor.
- Corpo: `multipart/form-data` com `file` (PDF, PNG ou JPEG, ate 5 MiB, um so arquivo) e
  `paidAlone` (texto `true` ou `false`, nada mais).
  - `paidAlone=true`: o sistema le o valor do PDF (texto nativo) ou da imagem (OCR em portugues).
  - `paidAlone=false` (gasto dividido): **nao ha leitura**; o arquivo so e guardado e o usuario
    informa o valor que pagou ao criar o gasto.
- Resposta: `201 {"receiptId": "<uuid>", "suggestedAmountCents": 12345}`. O valor sugerido e
  `null` quando nao foi possivel ler com seguranca (o sistema prefere nao sugerir a sugerir um
  valor errado); o upload continua valido e o usuario digita o valor.
- Validacao: o tipo real e conferido pelos primeiros bytes do arquivo, nao pelo nome nem pelo
  tipo informado. O nome enviado pelo cliente nunca e usado nem guardado.
- Erros: `400` arquivo vazio, tipo nao aceito ou diferente do informado, `paidAlone` ausente ou
  diferente de `true`/`false`, mais de um arquivo ou campo extra; `413` acima de 5 MiB; `429`
  limite de uploads por usuario (10 por janela de 60 s, por padrao).

**`GET /receipts/:id/file`**. Baixa o proprio comprovante.
- Resposta: `200` com os bytes do arquivo, `Content-Type` do tipo gravado, `attachment` e `nosniff`.
- Erros: `404` identico para comprovante inexistente, de outro usuario (admin incluso) ou cujo
  arquivo sumiu do disco.

### Gastos (`/expenses`)

Um gasto tem categoria, valor, data, forma de pagamento e, opcionalmente, um comprovante e uma descricao.

**`POST /expenses`**. Registra um gasto.
- Corpo:
  - `categoryId` (UUID de uma categoria global ou propria);
  - `amountCents` (inteiro de 1 a 1000000000): **sempre o valor que o usuario confirmou ou
    digitou**, mesmo quando ha comprovante e mesmo no gasto dividido (`paidAlone=false`);
  - `paidAlone` (booleano): se pagou sozinho ou dividiu;
  - `paymentMethod` (obrigatorio): forma de pagamento, exatamente `CREDIT`, `DEBIT` ou `PIX`
    (maiusculas; qualquer outro valor responde `400`);
  - `spentAt` (`YYYY-MM-DD`, data real do calendario, no maximo hoje + 1 dia em UTC);
  - `receiptId` (opcional, UUID de comprovante proprio; sem ele e um lancamento manual);
  - `description` (opcional, ate 500 caracteres).
- Resposta: `201 {"id": "<uuid>"}`.
- Erros: `404` categoria ou comprovante inexistente ou de outro usuario; `409` comprovante ja
  usado por outro gasto (cada comprovante vale para um gasto); `400` valor, data ou campo
  invalido, ou campo extra (`userId`, `id`, `createdAt`...).

**`GET /expenses`**. Lista os gastos do usuario, do mais recente para o mais antigo.
- Query (todas opcionais): `from` e `to` (`YYYY-MM-DD`, inclusivos, `from <= to`), `categoryId`
  (UUID), `paymentMethod` (`CREDIT`, `DEBIT` ou `PIX`; valor invalido responde `400`), `limit`
  (1 a 200, padrao 100), `offset` (0 a 100000).
- Resposta: `200 {"items": [...], "total": 42, "limit": 100, "offset": 0}`.

**`GET /expenses/:id`**. Devolve um gasto.
- Resposta: `200 {"id","categoryId","receiptId","amountCents","paidAlone","paymentMethod","spentAt","description","createdAt"}`.

**`PATCH /expenses/:id`**. Corrige um gasto (parcial).
- Corpo: ao menos um entre `categoryId`, `amountCents`, `spentAt`, `description`, `paidAlone`, `paymentMethod`.
  `receiptId` nao pode mudar (400).
- Resposta: `200` com o gasto atualizado.

**`DELETE /expenses/:id`**. Exclui um gasto.
- Resposta: `204`. O comprovante e o arquivo continuam guardados e o comprovante volta a poder ser
  usado em outro gasto.
- Erro: `409` se o gasto ja virou um emprestimo (exclua o emprestimo antes).

Em `GET`, `PATCH` e `DELETE`, um gasto inexistente ou de outro usuario responde `404`.

### Emprestimos (`/loans`)

Um emprestimo e dinheiro que o usuario deixou com alguem. Cada emprestimo tem o nome da pessoa
(`borrowerName`), um valor e um vencimento proprios; uma mesma pessoa pode ter varios e nao ha
parcelas. Ele pode nascer de um gasto ja registrado (uma compra paga para outra pessoa; o valor
vem do gasto e cada gasto gera no maximo um emprestimo) ou ser dinheiro emprestado direto, com o
valor informado. As pessoas nao tem cadastro: o nome e so um texto. Cada pagamento pertence a UM
emprestimo (o usuario informa qual) e `paidCents`, `remainingCents` e `status` saem da soma real
dos pagamentos, calculada numa unica consulta agregada.

**`POST /loans`**. Registra um emprestimo.
- Corpo:
  - `borrowerName`: nome da pessoa, de 1 a 100 caracteres;
  - `dueDate` (`YYYY-MM-DD`, data real do calendario, a partir de `2000-01-01`): pode estar no
    passado, para registrar uma divida antiga;
  - **exatamente um** entre `expenseId` (UUID de um gasto proprio; o valor e o do gasto) e
    `amountCents` (inteiro de 1 a 1000000000). Os dois, ou nenhum, respondem `400`.
- Resposta: `201 {"id": "<uuid>"}`.
- Erros: `404` gasto inexistente ou de outro usuario; `409` o gasto ja tem um emprestimo; `400`
  campo invalido ou extra (`userId`, `id`...).

**`GET /loans`**. Lista os emprestimos do usuario, do vencimento mais proximo para o mais distante.
- Query (todas opcionais): `borrower` (nome exato, sem diferenca de maiusculas e minusculas nem de
  espacos nas pontas), `status` (`OPEN`, `PAID` ou `OVERDUE`, em maiusculas, igual ao campo da resposta), `limit` (1 a 200, padrao 100),
  `offset` (0 a 100000). Valor invalido responde `400`.
- Resposta: `200 {"items": [...], "total": 3, "limit": 100, "offset": 0}`; `total` conta todos os
  que passam nos filtros.

**`GET /loans/summary`**. Resumo dos emprestimos do usuario, uma linha por pessoa (declarada antes
de `/loans/:id`, entao `summary` nunca e lido como id).
- Query (opcional): `borrower` (mesma comparacao de `GET /loans`: sem diferenca de maiusculas e
  minusculas nem de espacos nas pontas). Em branco ou parametro desconhecido responde `400`.
- Resposta: `200 {"items": [...], "totals": {...}, "truncated": false}`.
- Cada item de `items`: `borrowerName`, `loansCount`, `totalLentCents` (soma emprestada),
  `paidCents` (soma dos pagamentos), `owedCents` (`totalLentCents - paidCents`, o que ainda deve),
  `upcomingCents` (saldo dos emprestimos que ainda nao venceram, status `OPEN`), `overdueCents`
  (saldo dos vencidos, status `OVERDUE`), `overdueLoansCount` (quantos emprestimos estao vencidos)
  e `nextDueDate` (`YYYY-MM-DD`, o menor vencimento entre os emprestimos que ainda tem saldo, ou
  `null` se a pessoa quitou tudo). Sempre valem `owedCents = upcomingCents + overdueCents` e
  `owedCents = totalLentCents - paidCents`. Vencer hoje ainda e "a vencer".
- `totals` traz `totalLentCents`, `paidCents`, `owedCents`, `upcomingCents` e `overdueCents` de
  todas as pessoas (respeitando o filtro `borrower`), mesmo as que ficaram fora de `items`.
- Agrupamento: o nome e comparado sem diferenca de maiusculas e minusculas nem de espacos nas
  pontas (`Carlos` e ` carlos` sao a mesma pessoa); o nome exibido e o do emprestimo mais antigo
  do grupo. Nao ha cadastro de pessoas. Ordem: `overdueCents` do maior para o menor, depois o
  nome em ordem alfabetica.
- Teto: no maximo 500 pessoas em `items`. Se houver mais, ficam as que mais devem atrasado,
  `truncated` vira `true` e `totals` continua somando todas (nada some em silencio). Sem paginacao.
- Os calculos usam o mesmo saldo e a mesma data de hoje (dia UTC) do restante dos emprestimos; as
  somas sao em centavos inteiros e uma soma fora da faixa segura daria erro, nunca numero errado.

**`GET /loans/:id`**. Devolve um emprestimo.
- Resposta: `200 {"id","borrowerName","amountCents","dueDate","expenseId","paidCents","remainingCents","status","createdAt"}`.
  `expenseId` e `null` no dinheiro emprestado direto. `status` e `PAID` (saldo zero), `OVERDUE`
  (ha saldo e o vencimento ja passou) ou `OPEN` (ha saldo e vence hoje ou depois). Vencer hoje
  ainda e `OPEN`; o dia e o de calendario em UTC.

**`PATCH /loans/:id`**. Corrige um emprestimo (parcial).
- Corpo: ao menos um entre `borrowerName` e `dueDate`. O valor e o gasto de origem nao mudam (400).
- Resposta: `200` com o emprestimo atualizado.

**`DELETE /loans/:id`**. Exclui um emprestimo. Resposta: `204`. O gasto de origem continua e volta
a poder gerar outro emprestimo. Erro: `409` se o emprestimo ja tem pagamentos (o historico fica).

**`POST /loans/:id/payments`**. Registra um pagamento do emprestimo.
- Corpo:
  - `amountCents`: inteiro de 1 a 1000000000, o valor pago;
  - `method`: `CASH` (dinheiro fisico, valor digitado a mao, sem comprovante) ou `PIX`;
  - `paidAt` (`YYYY-MM-DD`): de `2000-01-01` ate hoje + 1 dia (UTC), a mesma folga dos gastos;
  - `receiptId` (UUID): **obrigatorio** em `PIX` e **proibido** em `CASH`. E o comprovante enviado
    antes por `POST /receipts`; o valor sugerido pelo comprovante nunca e usado, vale o `amountCents`.
- Regras: o pagamento nao pode passar do saldo restante (`400` com o saldo na mensagem); pagar o
  saldo exato quita o emprestimo (`status` `PAID`, mesmo se estava atrasado). Duas requisicoes
  simultaneas que somadas passam do valor nao passam as duas: o banco trava o emprestimo durante a
  gravacao e recalcula a soma. Um comprovante serve a um unico pagamento ou gasto, nunca a dois
  (`409`).
- Resposta: `201 {"id": "<uuid>"}`.
- Erros: `404` emprestimo inexistente ou de outro usuario (admin incluso), comprovante inexistente
  ou de outro usuario (identicos); `409` comprovante ja usado por outro pagamento ou por um gasto;
  `400` campo invalido, extra (`userId`, `loanId`, `id`...), `PIX` sem comprovante, `CASH` com
  comprovante ou pagamento acima do saldo.

**`GET /loans/:id/payments`**. Lista os pagamentos do emprestimo, do mais antigo para o mais novo
(por `paidAt`, depois `id`).
- Resposta: `200` com uma lista de `{"id","loanId","amountCents","method","receiptId","paidAt","createdAt"}`.
  `receiptId` e `null` em `CASH`. Nunca traz `userId`.

Criar um gasto com um comprovante que ja serve a um pagamento de emprestimo responde `409`.

Em `GET`, `PATCH` e `DELETE`, um emprestimo inexistente ou de outro usuario (admin incluso)
responde `404`; o mesmo vale para os dois endpoints de pagamentos.

### Relatorios (`/reports`)

Quatro rotas `GET` que alimentam os graficos. Todas olham **so os gastos do proprio usuario** e
somam no banco. Parametro ausente, repetido, desconhecido ou fora do formato responde `400`.
Valores em centavos, inteiros.

**`GET /reports/by-category?month=2026-11`**: "para onde vai o dinheiro". Total por categoria no
mes, da maior para a menor. `percentage` tem 2 casas e a soma e exatamente 100. Mes sem gastos:
`items: []` e `totalCents: 0`.

```json
{"month":"2026-11","totalCents":300,"items":[
  {"categoryId":"…","categoryName":"Alimentacao","totalCents":200,"percentage":66.67},
  {"categoryId":"…","categoryName":"Casa","totalCents":100,"percentage":33.33}]}
```

**`GET /reports/by-day?month=2026-11`**: "qual dia gastei mais". Total de cada dia que teve
gasto, em ordem de data, e o `topDay` (dia de maior total; em empate, o mais antigo). Mes vazio:
`days: []` e `topDay: null`.

```json
{"month":"2026-11","days":[{"date":"2026-11-02","totalCents":200},
  {"date":"2026-11-10","totalCents":450}],"topDay":{"date":"2026-11-10","totalCents":450}}
```

**`GET /reports/monthly-evolution?from=2025-11&to=2026-02`**: evolucao mes a mes. Todos os meses
do intervalo, com `0` nos meses sem gasto. `from <= to` e no maximo 24 meses (senao `400`).

```json
{"from":"2025-11","to":"2026-02","months":[{"month":"2025-11","totalCents":10},
  {"month":"2025-12","totalCents":0},{"month":"2026-01","totalCents":40},
  {"month":"2026-02","totalCents":0}]}
```

**`GET /reports/income-vs-spent?month=2026-11`**: quanto do salario ja foi gasto. Sem salario
cadastrado, `incomeCents`, `remainingCents` e `percentSpent` vem `null`. `remainingCents` pode ser
negativo e `percentSpent` pode passar de 100.

```json
{"month":"2026-11","incomeCents":500000,"spentCents":125000,"remainingCents":375000,
 "percentSpent":25}
```

Os quatro relatorios fecham o mesmo total para o mesmo mes (soma dos dias = soma das categorias =
`spentCents`).

### Limites de requisicao

| Onde | Limite padrao (por janela de 60 s) |
|---|---|
| Todas as rotas | 100 por IP |
| `/auth/register`, `/auth/login`, `/auth/refresh` | 20 por IP |
| `/auth/login` | 5 por IP + e-mail |
| `POST /receipts` | 10 por usuario |

Estouro responde `429`. Os valores e a janela (`THROTTLE_TTL_SECONDS`) sao configuraveis (ver
"Variaveis de ambiente").

## Variaveis de ambiente

Resumo (valores e exemplos em `.env.example`; detalhes na secao Configuracao):

| Variavel | Obrigatoria | Para que serve |
|---|---|---|
| `DATABASE_URL` | sim | Postgres da aplicacao |
| `JWT_ACCESS_SECRET` | sim | Segredo do access token (min. 32 caracteres, >= 10 distintos, sem placeholder) |
| `UPLOAD_DIR` | sim | Diretorio privado dos comprovantes (0700) |
| `PORT` | nao | Porta HTTP (3000) |
| `CORS_ORIGINS` | nao | Origens permitidas, separadas por virgula; vazio desliga CORS |
| `TRUST_PROXY` | nao | `false` ou numero exato de saltos de proxy (>= 1) |
| `THROTTLE_*`, `AUTH_THROTTLE_LIMIT`, `LOGIN_EMAIL_THROTTLE_LIMIT`, `UPLOAD_THROTTLE_LIMIT` | nao | Rate limits |
| `REQUEST_TIMEOUT_MS`, `HEADERS_TIMEOUT_MS`, `KEEP_ALIVE_TIMEOUT_MS` | nao | Timeouts do servidor |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | so no seed | Primeiro admin |
| `TEST_DATABASE_URL` | so nos testes | Banco de testes (nome termina em `_test`) |

## Configuracao

Copie `.env.example` para `.env` (lido pelos scripts npm; ver "Como rodar"). Variaveis obrigatorias: `DATABASE_URL`, `JWT_ACCESS_SECRET`
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

## Primeiro admin

Registro publico sempre cria usuarios normais. O primeiro admin vem do seed, que le
`ADMIN_EMAIL` e `ADMIN_PASSWORD` do ambiente (senha de 12 a 128 caracteres, mesma regra do
registro) e `DATABASE_URL`:

```
ADMIN_EMAIL=voce@exemplo.com ADMIN_PASSWORD='...' npm run seed   # ou preencha-os no .env
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
campo:

- **Nomes** (usuario, categoria) e **descricao** aceitam U+200D (ZWJ, emojis compostos), espacos
  Unicode visiveis e U+200C (ZWNJ, o "meio espaco" persa) **somente** quando o caractere anterior
  e o seguinte sao letras ou marcas (`\p{L}`/`\p{M}`, pela propriedade Script_Extensions) de
  escritas nao latinas que usam o ZWNJ: arabe (persa, curdo, urdu), hebraico, siriaco, thaana,
  devanagari, bengali, gurmukhi, gujarati, oriya, tamil, telugu, kannada, malaiala, sinhala,
  tailandes, lao, khmer e birmanes. Fica recusado no inicio, no fim, repetido, ao lado de espaco
  ou digito e entre letras latinas, cirilicas ou gregas (onde so serviria para disfarcar texto).
  `می‌خواهم` e `نیم‌فاصله` passam; `fo<ZWNJ>od` nao.
- A **descricao** do gasto ainda aceita TAB, LF e CR (o CRLF dos formularios); outros controles
  continuam recusados.
- O **e-mail** nao aceita nenhum espaco Unicode, ZWNJ/ZWJ nem caractere invisivel
  (`Default_Ignorable_Code_Point`, como U+034F, U+115F, U+3164 e os seletores de variacao, e o
  braille em branco U+2800).
- A **senha** de cadastro so recusa controles C0/C1/DEL, NUL e surrogates soltos. No login a
  senha e o refresh token sao opacos (so tamanho), para contas antigas continuarem entrando.

### E-mail normalizado

Antes de validar, buscar ou gravar, o e-mail passa por `NFKC`, `trim`, minusculas e conversao do
dominio para punycode (`domainToASCII`; dominio invalido da 400). A mesma funcao vale no registro,
no login, na busca por e-mail, no seed e na chave de rate limit do login. Assim `café@x.com` em
NFC e NFD, `ａ@x.com` (largura total) e `a@x.com`, e `user@münchen.de` e
`user@xn--mnchen-3ya.de` sao o mesmo e-mail (o segundo registro da 409), e contas ja existentes em
ASCII continuam entrando. O e-mail e **gravado normalizado** (`user@münchen.de` fica
`user@xn--mnchen-3ya.de`). O projeto ainda nao tem producao, entao nao ha migration de dados; em
producao, e-mails ja gravados fora dessa forma precisariam de uma migration que os normalize (e
trate colisoes) antes de subir esta versao.

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
  `ETag` e sem 304 (os cabecalhos condicionais `If-None-Match`, `If-Match`, `If-Modified-Since`,
  `If-Unmodified-Since` e `If-Range` sao descartados na entrada, ate `If-None-Match: *`) e
  `Cache-Control: no-store` em toda resposta, filtro global de erros sem stack,
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
