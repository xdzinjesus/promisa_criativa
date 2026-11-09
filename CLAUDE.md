# Regras de operação (Claude Code)

## Comunicação com o usuário
- Sempre em português, explicando tudo de forma muito simples, passo a passo, sem termos técnicos (ou explicando cada um).
- Sempre enviar o link exato de onde o usuário precisa clicar (GitHub, Vercel, Google Ads etc.), com o caminho de botões.

## Fluxo
PLANEJAR → DISTRIBUIR → IMPLEMENTAR → TESTAR → REVISAR → HANDOFF → CONTINUAR.
- Trabalho com várias etapas: GSD (`/gsd:new-project` ou `/gsd:phase`, `/gsd:plan-phase`, `/gsd:execute-phase`, `/gsd:verify-work`). Tarefa pequena: `/gsd:quick`.
- Tarefas independentes vão para subagentes em paralelo, cada um com escopo próprio e sem sobreposição de arquivos. Só o resumo volta ao contexto principal.

## Modelos (economia primeiro)
- Busca, leitura e tarefas mecânicas: `haiku` (Explore) ou `sonnet`.
- Implementação e testes: `sonnet`.
- `opus` só para arquitetura, decisões de alto impacto e revisão crítica.
- Fork (`subagent_type: "fork"`) nunca recebe `model`, para reaproveitar o cache.
- GSD: perfil `balanced` (padrão). Mudar com `/gsd:config`.

## Contexto
- Leia trechos (Grep, offset/limit), não arquivos ou documentações inteiras.
- Antes de compactar ou encerrar, registre o estado: `/gsd:pause-work` (vai para `.planning/`, versionado no git) e retome com `/gsd:resume-work`.
- Na mesma sessão, depois de compactar: `/super-token-saver:s-continue`.
- Em sessões na nuvem o container é temporário: só sobrevive o que estiver commitado e enviado (push).

## Ferramentas sob demanda
- `/arena-mode:arena`: só quando houver 2 ou mais abordagens realmente diferentes e o custo do erro for alto. Padrão econômico: `n=3 solver-model=sonnet judge-model=opus`.
- `ui-ux-pro-max`: interfaces, design system, acessibilidade e responsividade.
- REA (MCP `rea` e skill `rea:reverse-engineer-anything`): apenas em alvos que o usuário possui ou tem autorização para analisar.

## Discord
- Antes de mexer em qualquer coisa do Discord (`api/discord.js`, `lib/discord*.js`, `src/discord-panel.js`), leia `docs/DISCORD.md`.

## Segurança do projeto
- Preserve dados, configurações e funcionalidades existentes. Nunca exclua dados nem altere credenciais ou `.env*` sem autorização.
- Não instale ferramentas nem execute scripts externos sem verificar a origem.
- O deploy (Vercel) publica apenas `public/`, gerado por `build.mjs`. `private/` só é servido pela função autenticada.
- Testes: `npm test` (unitários) e `npm run test:browser` (Playwright).
