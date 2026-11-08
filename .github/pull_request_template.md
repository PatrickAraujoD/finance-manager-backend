## O que muda e por que

<!-- Uma ou duas frases. Link para tarefa do plano, se houver. -->

## Checklist

- [ ] TDD: o teste vermelho veio antes do codigo (commits `test:` antes de `feat:`/`fix:`)
- [ ] Commits no formato `tipo: descricao`, sem escopo, cabecalho ate 72 caracteres
- [ ] `npm run lint`, `npm test`, `npm run test:integration` e `npm run test:e2e` passam
- [ ] Sem segredos, `.env` ou comprovantes no diff; entradas validadas e erros sem stack trace
- [ ] Rotas novas sao privadas por padrao (so `@Public()` com justificativa) e checam o dono
- [ ] `npm audit` nao trouxe advisory novo (ou o `scripts/audit-gate.js` foi atualizado com motivo)
- [ ] README/docs atualizados se variaveis de ambiente ou rotas mudaram
