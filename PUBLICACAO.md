# Publicação na Vercel

## Arquivos

Envie os arquivos do projeto ao repositório conectado à Vercel, incluindo `api/`, `lib/`, `src/`, `private/`, `assets/`, `package.json`, `build.mjs`, `vercel.json`, `acesso.html` e as páginas públicas existentes. A função inclui `private/` no seu pacote sem copiá-la para `public/`.

Não envie `.env.local`, outros arquivos `.env`, o backup `.bak`, a pasta `promisa-repository/` nem a pasta gerada `public/`. O ZIP de entrega exclui esses itens. Não copie o HTML administrativo para a pasta pública, pois isso permitiria acesso sem senha.

Framework Preset: **Other**. Build Command: `node build.mjs`. Output Directory: `public`. Node.js: **22.x**. As regras de `/admin` e `/catalogo` estão em `vercel.json`; não adicione um redirecionamento geral para index.html.

## Variáveis de ambiente obrigatórias

Em Settings → Environment Variables do projeto na Vercel, configure:

| Variável | Valor |
| --- | --- |
| `ADMIN_PASSWORD` | A senha de acesso solicitada pelo responsável. Use uma senha de pelo menos 12 caracteres, longa e exclusiva, cadastrada diretamente no painel seguro da Vercel. Nunca a envie no chat ou no GitHub. |
| `ADMIN_SESSION_SECRET` | Um segredo aleatório com pelo menos 32 caracteres, diferente da senha. |
| `SITE_URL` | Opcional: URL pública HTTPS real do site. Sem ela, o build usa a URL fornecida pela Vercel. |

Para gerar o segredo no seu computador:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Copie o resultado diretamente para a variável na Vercel. Não coloque o segredo no HTML, JavaScript público ou repositório. Cadastre as variáveis nos ambientes em que deseja usar o acesso e faça um novo deploy. Abrir os arquivos por file:// ou em um servidor exclusivamente estático não habilita o login.

## Acesso

1. No final da página, clique em **Área administrativa**.
2. Informe a senha.
3. Escolha **Área administrativa** ou **Catálogo dos meus projetos**.
4. Use **Sair** para encerrar o acesso naquele navegador.

A validação ocorre em `api/access.js`. Abrir a entrada administrativa exige a senha novamente, sem pular automaticamente para a escolha de áreas. A sessão dura no máximo quinze minutos, usa cookie HttpOnly e SameSite=Strict, e recebe Secure na Vercel. As páginas privadas têm no-store e noindex. Alterar a senha ou o segredo invalida as sessões existentes. Em produção, o Blob privado armazena sessões revogáveis e contadores de tentativas compartilhados entre instâncias. Sem BLOB_READ_WRITE_TOKEN, o login de produção falha de forma segura. Localmente, sem Blob, o estado de autenticação existe apenas em memória. Configure também o firewall da hospedagem para limitar abuso e custos antes da função.

## Armazenamento e hospedagem

O painel sincroniza dados e arquivos entre aparelhos usando Vercel Blob privado. Leia `DADOS-ONLINE.md` para conectar o recurso e enviar os dados antigos. Até o indicador mostrar Salvo online, a cópia pode existir apenas no aparelho. Importar arquivos não publica automaticamente os sites dos clientes.

## Verificação

O build, os testes locais de autenticação, a sintaxe dos scripts e as referências aos arquivos públicos foram verificados. Depois de publicar, teste rodapé, senha incorreta, as duas opções, importação de um site, catálogo e saída. Em uma janela anônima, `/admin` e `/catalogo` devem redirecionar ao login. URLs inexistentes devem retornar 404.

Os assets ausentes foram recuperados de `index.original.html.bak`. A imagem social usa uma prévia recuperada, pois o PNG social anterior não estava nesta pasta.

O código pode ser enviado ao GitHub sem segredos. A ativação online depende do armazenamento privado e de um novo deploy. A verificação visual no navegador não foi concluída: a ferramenta de prévia falhou ao inicializar neste ambiente.


## Depois das correções de segurança

- O segredo/senha atuais invalidam os cookies da versão anterior; os usuários precisarão entrar novamente.
- A aplicação de produção passa a exigir o Blob privado também para login e logout revogáveis. Confirme `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` e `BLOB_READ_WRITE_TOKEN` antes de publicar.
- A limpeza diária é declarada em `vercel.json`. Cadastre `CRON_SECRET` exclusivo, aleatório, com pelo menos 32 caracteres na Vercel; o cron deve enviar `Authorization: Bearer <CRON_SECRET>`. Sem isso, a limpeza retorna 503 e nenhum arquivo é apagado. Não reutilize o segredo de sessão.
- Objetos sem referências, com mais de sete dias desde a criação ou a última remoção de vínculo (o que ocorrer por último) tornam-se elegíveis à limpeza. Esse prazo é técnico para recuperação, não substitui os prazos legais de conservação. O horário do cron é 06:00 UTC. A limpeza não foi executada no armazenamento real durante o desenvolvimento.
- Rode primeiro `node --env-file=.env.local scripts/storage-maintenance.mjs` para simular. `--apply` permite exclusão física; use somente no ambiente pretendido e após conferir backups. As referências do manifesto ficam protegidas por uma janela de manutenção durante a remoção.
- Use armazenamento e credenciais separados em produção e preview; proteja deploys de preview e restrinja permissões no GitHub/Vercel.
- Cadastre MFA/passkeys nas contas de infraestrutura. O painel continua com senha administrativa única; contas individuais e MFA dentro do aplicativo exigem integração de identidade adicional.
- Confirme os dados institucionais do controlador, os contratos/regiões dos fornecedores e os prazos legais por categoria antes de declarar conformidade com a LGPD. Veja `SEGURANCA-E-PRIVACIDADE.md`.
