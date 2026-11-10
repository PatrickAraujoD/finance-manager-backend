# Status do projeto (visao do CTO)

Ultima atualizacao: 2026-11-10 (cartao de credito como saldo separado; contagens refeitas). Fonte detalhada: `docs/superpowers/plans/2026-11-08-finance-manager-backend.md`.

## Quadro de tarefas

| # | Tarefa | Estado |
|---|---|---|
| 1 | Scaffold, fronteiras de camada, commitlint e husky | aprovada |
| 2 | Dominio base (Money, Email, Role, erros) | aprovada |
| 3 | Entidades e portas | aprovada |
| 4 | Autenticacao (register, login, refresh rotativo, logout) | aprovada |
| 5 | Usuarios (admin) e Categorias | aprovada |
| 6 | Renda mensal | aprovada |
| 7 | Comprovantes e extracao (PDF, OCR), Partes A e B | aprovada |
| 8 | Gastos | aprovada |
| 9 | Relatorios (4 endpoints iniciais; hoje 5, com `reports/card`) | aprovada (correcoes de review: a9b6885, 09e14f7) |
| 10 | Endurecimento e fechamento (matriz de autorizacao, README final) | feita (f5495c4); o fluxo manual com curl NAO foi feito, coberto pelo e2e `user-journey` |
| - | CI/CD (workflow, Dockerfile, dependabot, docs) | escrito pelo DevOps; workflow ainda NAO rodou no GitHub (`origin` sem push); imagem Docker construida e testada localmente (`docs/pipeline-status.md`) |
| - | Forma de pagamento nas despesas (`paymentMethod`: `CREDIT`, `DEBIT`, `PIX`; obrigatoria; despesas antigas migradas como `PIX`) | feita na branch `feature/loans` |
| - | Emprestimos (`/loans`: criar de um gasto ou em dinheiro, listar com filtros, ver, corrigir nome/vencimento, excluir; saldo e situacao `OPEN`/`PAID`/`OVERDUE` calculados no dominio). Pagamentos (`/loans/:id/payments`, dinheiro ou Pix com comprovante, soma travada no banco para nao passar do valor). Resumo por pessoa (`GET /loans/summary`: emprestado, pago, deve, a vencer, atrasado, proximo vencimento; teto de 500 pessoas com `truncated`) | feita na branch `feature/loans` |
| - | Cartao de credito como saldo separado (`CASH`, `isCardPayment`, emprestimo direto com `paymentMethod`/`lentAt`, `GET /reports/card`, novo `income-vs-spent`) | feita na branch `feature/credit-card`, que depende de `feature/loans`; o MR de loans deve vir primeiro |
| - | Revisao final | em andamento: correcoes de audit gate, check-secrets, CI e docs aplicadas; contagens de 2026-11-10 (branch `feature/credit-card`): 1548 unit (57 suites) / 250 integration passam e 1 falha conhecida (env-file, porta 3000 ocupada) de 251 (17 suites) / 803 e2e (22 suites) |

## Cartao de credito como saldo separado

Entregue na branch `feature/credit-card` (3 migrations novas: `20261110100000_expense_payment_method_cash`,
`20261110110000_expense_is_card_payment`, `20261110120000_loan_payment_method`; colunas anulaveis,
preenchimento de `PIX` e `createdAt::date` nos emprestimos diretos existentes e um `CHECK`). Quem
aplicou uma versao anterior de `..._loan_payment_method` num banco local deve recriar o banco (a
migration foi editada antes de ser lancada).

- Modelo de dois "dinheiros": a conta (`DEBIT`, `PIX`, `CASH`) tira do salario; o cartao (`CREDIT`)
  so faz subir o valor do cartao. Pagar o cartao e cadastrar um gasto com `isCardPayment: true` pago
  por `PIX`/`CASH`/`DEBIT` (com `CREDIT` responde 400); ele sai do salario e baixa o cartao.
  Exemplo: renda 5000; compra no credito 1000 -> disponivel 5000, cartao 1000; Pix 200 -> 4800;
  paga a fatura de 1000 por Pix -> 3800, cartao 0; recebe 100 em dinheiro de emprestimo -> 3900.
- Gastos: `paymentMethod` ganhou `CASH`; `isCardPayment` opcional (padrao `false`) em POST/PATCH, na
  resposta e no filtro `?isCardPayment=true|false`. Despesa de fatura nao pode lastrear emprestimo (400).
- Emprestimos: `POST /loans` direto exige `paymentMethod`. **Mudanca incompativel:** sem ele agora
  e 400. `lentAt` opcional (padrao hoje, no maximo hoje + 1 dia, piso `2000-01-01`); com `expenseId`
  os dois sao proibidos (400) e as respostas trazem `null`. `PATCH` continua so nome e vencimento.
- Relatorios: nova rota `GET /reports/card`; `income-vs-spent` mudou (**incompativel**): `spentCents`
  e a saida da conta, com `receivedCents` e `creditSpentCents` novos e
  `remainingCents = renda - spent + received`. `by-category`, `by-day` e `monthly-evolution` ignoram
  pagamentos de fatura e emprestimos, entao nao fecham mais o mesmo total que `income-vs-spent`.
- A API passou de 33 para 34 rotas (README e `authorization-matrix` conferidos).

Decisoes do autor:
- Sem limite de credito e sem ciclo de fechamento de fatura: o valor do cartao e acumulado
  (cobrancas menos pagamentos de fatura) ate o fim do mes consultado.
- O cartao pode ficar negativo (pagou a mais).
- O saldo da conta e por mes, sem sobra acumulada dos meses anteriores.
- `GET /reports/card` e os demais relatorios sao do proprio usuario; o admin nao ve os de outros.

Dividas tecnicas conhecidas desta branch:
- `Loan` nao tem indice para as novas consultas de relatorio por `(userId, lentAt)` / `paymentMethod`;
  nao foi medido com `EXPLAIN`.
- O relatorio na virada de ano (dez -> jan) tem teste de integracao (`prisma-report.repository.spec.ts`:
  `accountOutflow`, `directLoansOutflow` e a evolucao mensal); nao foi conferido o caso do cartao
  (`openingCents`) especificamente na virada.
- O backfill das migrations foi verificado so manualmente (lendo o SQL); nao ha teste automatizado.
- `tsc --noEmit` falha no commit historico `15671a2` (ja documentado acima).
- `test/integration/env-file.spec.ts` depende da porta 3000 livre (falhou nesta rodada, 1 de 251).
- O teste `pdf-hostile` (memoria) e instavel sob carga; nao falhou nesta rodada.
- O helper `stable()` da `authorization-matrix` agora ignora o cabecalho `x-ratelimit-reset`.

## Emprestimos e forma de pagamento

Entregue na branch `feature/loans` (3 migrations novas: `expense_payment_method`, `loans`,
`loan_payments`):
- `paymentMethod` obrigatorio nas despesas (`CREDIT`, `DEBIT`, `PIX`); as despesas antigas foram
  migradas como `PIX`. **Mudanca incompativel:** clientes antigos de `POST /expenses` que nao
  enviam o campo passam a receber `400`.
- Emprestimos: criar a partir de uma despesa ou em dinheiro, listar, ver, corrigir nome/vencimento,
  excluir (409 se tiver pagamentos; apagar uma despesa que virou emprestimo tambem responde 409).
  Situacao `OPEN`/`PAID`/`OVERDUE` calculada no dominio; vencimento minimo `2000-01-01`.
- Pagamentos por emprestimo: `CASH` sem comprovante, `PIX` com comprovante, nunca acima do saldo,
  e um comprovante nao serve a despesa e ao pagamento ao mesmo tempo.
- Resumo por pessoa (`GET /loans/summary`), teto de 500 pessoas com `truncated`.
- A API passou de 25 para 33 rotas (README e `authorization-matrix` conferidos).

Decisoes do usuario:
- Cada compra paga para alguem vira um emprestimo proprio, vinculado a despesa.
- Todo pagamento acontece dentro de um emprestimo especifico (nao ha pagamento "solto" por pessoa).
- Atraso = vencido e com saldo.
- Um pagamento pode ter data anterior ao cadastro do emprestimo.
- Risco residual aceito: a corrida despesa x pagamento com o mesmo comprovante (ver "Requisitos
  futuros").

Dividas tecnicas conhecidas:
- Listagem e resumo de emprestimos filtram e agrupam em memoria (ver "Requisitos futuros").
- O backfill `PIX` das despesas antigas foi verificado so lendo o SQL da migration
  (`ADD COLUMN ... DEFAULT 'PIX'` seguido de `DROP DEFAULT`); nao ha teste automatizado dele.
- `tsc --noEmit` falha no commit `15671a2` do historico (verificado em 2026-11-09 num worktree
  temporario: erros de aridade em `test/unit/application/loans/*.spec.ts`); a branch atual passa.
  O motivo atribuido a um stash vem do registro do usuario e nao foi reverificado.
- `test/integration/env-file.spec.ts` depende de a porta 3000 estar livre.

## Decisoes-chave

- **Arquitetura limpa em 4 camadas** (`domain` <- `application` <- `infrastructure`/`presentation`),
  imposta pelo lint (`eslint-plugin-boundaries`): domain/application nao importam Nest, Prisma nem
  libs de infra.
- **Money proprio** sobre inteiro em centavos, em vez de dinero.js (ESM-only, incompativel com o
  Jest CJS). Nunca ha `number` float em regra de negocio; BIGINT no banco com erro (nunca
  arredondamento) acima do inteiro seguro.
- **`file-type` removido:** travava o event loop com ASF malformado e lancava erro em TIFF/PNG
  curtos. Hoje a deteccao e por assinatura (magic bytes) propria.
- **PDF em processo filho descartavel** (substituiu `worker_threads`, que vazava ~7 MB por execucao
  e nao limitava memoria real), com vigia de RSS lendo `/proc` ou `ps` (falha fechada) e por isso
  `procps` na imagem Docker.
- **OCR** com `tesseract.js` (dados `por` locais), no maximo 2 simultaneos, imagem limitada a 25 MP;
  falha de extracao devolve `suggestedAmountCents: null`, nunca 500. O valor e so sugestao: o gasto
  sempre usa o `amountCents` confirmado pelo usuario.
- **Guard global fail-closed:** `JwtAuthGuard` e `RolesGuard` como `APP_GUARD`; toda rota e privada
  salvo `@Public()`. Publicas hoje: `/health` e `/auth/{register,login,refresh,logout}`, travadas
  por teste e2e.
- **Autorizacao nos casos de uso**, nao so em guards; admin NAO le gastos/salario de terceiros;
  recurso alheio responde 404 identico ao inexistente.
- **`spentAt` e uma DATA de calendario** guardada como `Date` 00:00 UTC (evita deslocar compras por
  fuso); agrupamentos e filtros em UTC.
- **Auth:** access token 15 min; refresh opaco, rotativo, so o hash no banco; reuso revoga a
  familia; throttle de login por IP e por IP+e-mail normalizado.
- **`TRUST_PROXY`** so `false` ou inteiro >= 1; `true`/`0` derrubam a subida.
- **Validacao:** `ValidationError` do dominio vira 400 (nunca 422); texto sem NUL, surrogates soltos
  e caracteres de controle; teto de valores tambem em CHECK no banco.
- **Relatorios:** `GROUP BY` no Postgres via `Prisma.sql` parametrizado, uma consulta por relatorio,
  percentuais em BigInt pelo metodo do maior resto (soma exatamente 100).
- **Commits:** Conventional Commits sem escopo, sem rodape de coautoria, validados por commitlint
  local (husky) e no CI.
- **Decisoes da revisao final:** o audit gate falha FECHADO (JSON vazio/invalido/inesperado ou
  erro do `npm audit` = falha); `check-secrets` cobre atribuicoes `*_SECRET`/`*_PASSWORD`/`*_TOKEN`,
  tokens de fornecedores e cadeias de alta entropia, exige `.env.example` sem valores reais e nao
  pula arquivos de configuracao ilegiveis; o CI ganhou `check-secrets`, verificacao de Node
  >= 22.9 e o job `docker-build` (sem push, SHAs fixados).
- **Imagem Docker validada localmente:** uid 1000, `/data/uploads` 0700, healthcheck `healthy`,
  upload de PDF e PNG com OCR no conteiner, ~1,09 GB. Nao validado: migrations pelo estagio
  `build`, `hadolint`, Trivy.
- **Riscos de dependencia aceitos** com prazo (`image-size`, `deepmerge-ts`/prisma): ver
  `scripts/audit-gate.js`.

## Pendencias e donos

| Pendencia | Dono |
|---|---|
| Primeiro push e primeiro run do CI (7 jobs); corrigir o que falhar | usuario (push) + devops |
| Ligar branch protection no `main` | usuario |
| Rodar a suite em Node 22 (local e Node 26; CI e Docker usam 22) | devops (no primeiro run do CI) |
| Validar migrations pelo estagio `build`; rodar `hadolint` e Trivy | devops |
| Definir ambiente de producao e CD | devops (apos decisao do usuario sobre hospedagem) |
| Fluxo manual com curl contra servidor real (Tarefa 10, Step 3) | implementer/usuario |
| 429 do upload nao testado em producao; rate limit em memoria por instancia | devops + CTO (antes de escalar) |
| Homoglifos entre escritas (Cyrillic `і` vs Latin `i`) nao tratados | CTO (decidir se vale tratar) |
| Encerrar processos jest travados PIDs 96469/96489 | usuario |
| Revisar advisories aceitos ate 2027-02-08; avaliar Prisma 7 | devops + CTO |

## Requisitos futuros reportados pelos reviewers

- **Semaforo de PDF/OCR com degradacao cruzada:** hoje PDF e OCR competem por recursos; sob carga
  um tipo pode degradar o outro (retornando `null`). Avaliar semaforos/filas separados por tipo.
- **Listagem e resumo de emprestimos trabalham em memoria (divida tecnica):** `GET /loans` e
  `GET /loans/summary` carregam TODOS os
  emprestimos do usuario (so filtrados por `borrower` no SQL), calcula o saldo de cada um com uma
  unica soma agregada de pagamentos e so entao filtra por `status` e pagina em memoria. O custo
  cresce com a quantidade de emprestimos de um usuario. O que mitiga hoje: o dono so ve os
  proprios emprestimos (nunca os de outros nem os do admin), o throttler global limita as
  requisicoes, os tetos de valor e o `limit`/`offset` limitam o que sai na resposta, e uma pessoa
  tem poucos emprestimos. Opcao futura: mover o filtro de `status` para SQL (saldo e vencimento
  vs. hoje numa unica consulta com paginacao no banco) e/ou impor um teto de emprestimos por
  usuario. O resumo tem o mesmo custo (carrega todos os emprestimos do usuario, com a mesma
  soma agregada de pagamentos, e agrupa em memoria) e a mesma mitigacao; o teto de 500 pessoas
  limita so o tamanho da resposta, nao o trabalho. Opcao futura: agregar por pessoa no SQL.
- **Comprovante entre gasto e pagamento nao e unico no banco:** cada tabela garante
  `UNIQUE(receiptId)` e o codigo recusa (409) o comprovante que ja serve a outra tabela, mas ha
  uma janela minuscula se um gasto e um pagamento com o MESMO comprovante forem gravados no mesmo
  instante. So o proprio dono e afetado: o comprovante e sempre do usuario que o enviou, entao
  nao ha vazamento entre usuarios nem corrupcao de saldo; no pior caso um comprovante serve a
  dois registros do mesmo usuario. Opcao futura: tabela unica de uso de comprovante ou gatilho
  no banco.
- **Paginacao** de `GET /users` e `GET /categories` (hoje limitados a 500 resultados).
- **`TRUST_PROXY` em deploy:** definir o numero exato de saltos do ambiente real.
- **CHECK/limite de quantidade:** limites de quantidade por usuario (comprovantes, gastos,
  categorias) e CHECKs adicionais no banco, alem dos tetos de valor ja existentes.
- Poliglotas (arquivo valido como PDF/PNG/JPEG e como HTML/JS): ja mitigado servindo sempre com
  tipo do banco, `nosniff` e `attachment`; manter o teste.
- Armazenamento de comprovantes com varias replicas (storage compartilhado/objeto) e backup.
- Migrations compativeis com rollback quando houver CD.
