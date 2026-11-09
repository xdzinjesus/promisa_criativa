# Instruções para agentes (Codex e outros)

Este projeto segue as mesmas regras para qualquer agente de IA (Claude Code, Codex etc.).

1. Leia e siga o `CLAUDE.md`: comunicação em português simples, segurança, fluxo de trabalho e testes.
2. Para mexer no Discord (`api/discord.js`, `lib/discord*.js`, `src/discord-panel.js`), leia antes o `docs/DISCORD.md`.
3. Como preparar a máquina e ligar os agentes: `docs/LIGAR-AGENTE.md`.
4. **Trabalhe numa branch própria** (ex.: `codex/nome-da-tarefa`), abra um PR e **não faça merge** sem aprovação do dono.
5. **Antes de começar, informe quais arquivos vai alterar.** Outro agente pode estar trabalhando no mesmo projeto, e dois agentes não devem editar os mesmos arquivos ao mesmo tempo.
6. **Nunca peça, registre nem grave tokens ou senhas.** Eles são digitados só no próprio computador.
7. **Sites de clientes não entram neste repositório.** Ficam em `PromisaSites/<cliente>/` e são entregues como HTML ou ZIP.
8. Antes de entregar, tudo precisa passar:
   1. `SITE_URL=https://example.test node build.mjs`
   2. `npm test`
   3. `npx playwright test --trace off`
