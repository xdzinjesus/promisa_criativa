# Como ligar um agente (Claude Code ou Codex) em qualquer máquina

Guia simples para colocar o **Claude Code** ou o **Codex** para trabalhar no projeto Promisa em qualquer computador
(Windows, Mac ou Linux). O Claude Code também pode ser ligado ao **Discord**.

> Regras de ouro
> - **Tokens e senhas só são digitados no próprio computador.** Nunca em chat, Discord, GitHub ou arquivo do projeto.
> - **Um agente por tarefa.** Antes de começar, o agente informa quais arquivos vai mexer, para dois agentes não editarem os mesmos arquivos ao mesmo tempo.
> - **Merge (aprovação) só com o dono.** O agente trabalha numa branch própria e abre um PR.
> - **Sites de clientes ficam fora do repositório**, em `PromisaSites/<cliente>/`.

---

## 1. Preparar a máquina (uma vez)

**Windows (PowerShell):**

1. Instalar o Git:
   ```bash
   winget install --id Git.Git -e
   ```
2. Instalar o Bun (só é preciso para ligar o Claude Code ao Discord):
   ```bash
   powershell -c "irm bun.sh/install.ps1 | iex"
   ```

**Mac / Linux (Terminal):**

1. Instalar o Bun (só é preciso para ligar o Claude Code ao Discord):
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

Depois, **feche e abra o terminal** e baixe o projeto:

1. Baixar o repositório:
   ```bash
   git clone https://github.com/xdzinjesus/promisa_criativa
   ```
2. Entrar na pasta dele:
   ```bash
   cd promisa_criativa
   ```
3. Instalar as dependências:
   ```bash
   npm install
   ```

---

## 2A. Claude Code

1. Instalar:
   - **Windows:**
     ```bash
     irm https://claude.ai/install.ps1 | iex
     ```
   - **Mac / Linux:**
     ```bash
     curl -fsSL https://claude.ai/install.sh | bash
     ```
2. Abrir dentro da pasta do projeto:
   ```bash
   claude
   ```
   Na primeira vez, faça o login com a conta do Claude.
3. O Claude Code lê sozinho o `CLAUDE.md`, que contém as regras do projeto.

### Ligar o Claude Code ao Discord (opcional)

Use um **robô próprio** para isso (ex.: "Promisa Code"). **Não** use o robô "Promisa", que é do sistema e manda tudo para a Vercel.

1. **No portal do Discord** (https://discord.com/developers/applications):
   1. Abra o robô e vá em **Bot**. Ligue **Message Content Intent** e salve.
   2. Clique em **Reset Token** e copie o token.
   3. Vá em **OAuth2 → URL Generator**.
      - **Scopes:** marque `bot`.
      - **Bot Permissions:** marque View Channels, Send Messages, Send Messages in Threads, Read Message History, Attach Files e Add Reactions.
   4. Abra a URL gerada e convide o robô para o servidor Promisa.
2. **No terminal**, dentro do Claude Code:
   1. Instale o plugin:
      ```bash
      /plugin install discord@claude-plugins-official
      ```
   2. Cole o token (digitado só aqui):
      ```bash
      /discord:configure SEU_TOKEN
      ```
   3. Saia do Claude Code:
      ```bash
      /exit
      ```
3. Abra o Claude Code já ligado ao Discord. **Use sempre este comando**, porque só `claude` não liga o Discord:
   ```bash
   claude --channels plugin:discord@claude-plugins-official
   ```
4. **Parear e trancar:**
   1. No Discord, mande uma mensagem privada para o robô. Ele responde com um código.
   2. No terminal, digite o código:
      ```bash
      /discord:access pair CODIGO
      ```
   3. Tranque para só você usar:
      ```bash
      /discord:access policy allowlist
      ```
5. **Teste:** mande ao robô "Cria um HTML simples escrito teste e me manda o arquivo aqui".

O robô só responde **enquanto o terminal estiver aberto e a máquina ligada** (desligue a suspensão do computador).
Se a bolinha do robô estiver **cinza**, o Claude Code não está conectado: confira o comando do passo 3 e se o token foi carregado (`/exit` e abrir de novo).

---

## 2B. Codex (OpenAI)

1. Instalar:
   ```bash
   npm install -g @openai/codex
   ```
2. Abrir dentro da pasta do projeto:
   ```bash
   codex
   ```
   Escolha **"Sign in with ChatGPT"**. Funciona com a assinatura do ChatGPT, sem chave de API.
3. O Codex lê sozinho o `AGENTS.md`, que manda seguir o `CLAUDE.md` e os guias de `docs/`.
4. Para uma tarefa sem conversa (útil para automação), rode a tarefa sem perguntas:
   ```bash
   codex exec --sandbox workspace-write "sua tarefa aqui"
   ```

**Codex e Discord:** não existe plugin oficial do Codex para o Discord. Para usar o Codex pelo Discord, é preciso um robô próprio
(projeto à parte, fora deste repositório) que chame o `codex exec` numa pasta isolada. As regras desse robô:

- só atende o dono;
- não executa comandos vindos do chat;
- usa `--sandbox workspace-write`;
- entrega HTML ou ZIP no canal `🏗️・sites-em-criacao`.

---

## 3. Antes de entregar qualquer mudança no projeto

1. Gerar o site:
   ```bash
   SITE_URL=https://example.test node build.mjs
   ```
2. Rodar os testes unitários:
   ```bash
   npm test
   ```
3. Rodar os testes no navegador:
   ```bash
   npx playwright test --trace off
   ```

Tudo precisa passar. Depois:

1. Faça commit numa branch própria (ex.: `pc/nome-da-tarefa` ou `codex/nome-da-tarefa`).
2. Faça o push e abra um PR.
3. O dono aprova.

Para mexer no Discord, leia antes o `docs/DISCORD.md`.
