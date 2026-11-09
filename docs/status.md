# Status do projeto (visao do CTO)

Ultima atualizacao: 2026-11-08 (revisao final). Fonte detalhada: `docs/superpowers/plans/2026-11-08-finance-manager-backend.md`.

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
| 9 | Relatorios (4 endpoints) | aprovada (correcoes de review: a9b6885, 09e14f7) |
| 10 | Endurecimento e fechamento (matriz de autorizacao, README final) | feita (f5495c4); o fluxo manual com curl NAO foi feito, coberto pelo e2e `user-journey` |
| - | CI/CD (workflow, Dockerfile, dependabot, docs) | escrito pelo DevOps; workflow ainda NAO rodou no GitHub (`origin` sem push); imagem Docker construida e testada localmente (`docs/pipeline-status.md`) |
| - | Forma de pagamento nas despesas (`paymentMethod`: `CREDIT`, `DEBIT`, `PIX`; obrigatoria; despesas antigas migradas como `PIX`) | feita na branch `feature/loans` |
| - | Emprestimos (`/loans`: criar de um gasto ou em dinheiro, listar com filtros, ver, corrigir nome/vencimento, excluir; saldo e situacao `OPEN`/`PAID`/`OVERDUE` calculados no dominio). Pagamentos (`/loans/:id/payments`, dinheiro ou Pix com comprovante, soma travada no banco para nao passar do valor). Falta o resumo por pessoa | feita na branch `feature/loans`, sem o resumo ainda |
| - | Revisao final | em andamento: correcoes de audit gate, check-secrets, CI e docs aplicadas; contagens 1059 unit / 168 integration / 517 e2e |

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
- **Listagem de emprestimos pagina em memoria (divida tecnica):** `GET /loans` carrega TODOS os
  emprestimos do usuario (so filtrados por `borrower` no SQL), calcula o saldo de cada um com uma
  unica soma agregada de pagamentos e so entao filtra por `status` e pagina em memoria. O custo
  cresce com a quantidade de emprestimos de um usuario. O que mitiga hoje: o dono so ve os
  proprios emprestimos (nunca os de outros nem os do admin), o throttler global limita as
  requisicoes, os tetos de valor e o `limit`/`offset` limitam o que sai na resposta, e uma pessoa
  tem poucos emprestimos. Opcao futura: mover o filtro de `status` para SQL (saldo e vencimento
  vs. hoje numa unica consulta com paginacao no banco) e/ou impor um teto de emprestimos por
  usuario.
- **Comprovante entre gasto e pagamento nao e unico no banco:** cada tabela garante
  `UNIQUE(receiptId)` e o codigo recusa (409) o comprovante que ja serve a outra tabela, mas ha
  uma janela minuscula se um gasto e um pagamento com o MESMO comprovante forem gravados no mesmo
  instante. Opcao futura: tabela unica de uso de comprovante ou gatilho no banco.
- **Paginacao** de `GET /users` e `GET /categories` (hoje limitados a 500 resultados).
- **`TRUST_PROXY` em deploy:** definir o numero exato de saltos do ambiente real.
- **CHECK/limite de quantidade:** limites de quantidade por usuario (comprovantes, gastos,
  categorias) e CHECKs adicionais no banco, alem dos tetos de valor ja existentes.
- Poliglotas (arquivo valido como PDF/PNG/JPEG e como HTML/JS): ja mitigado servindo sempre com
  tipo do banco, `nosniff` e `attachment`; manter o teste.
- Armazenamento de comprovantes com varias replicas (storage compartilhado/objeto) e backup.
- Migrations compativeis com rollback quando houver CD.
