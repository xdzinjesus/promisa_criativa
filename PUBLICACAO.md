# Publicação na Vercel

## Arquivos

Envie os arquivos do projeto ao repositório conectado à Vercel, incluindo `api/`, `lib/`, `src/`, `private/`, `assets/`, `package.json`, `build.mjs`, `vercel.json`, `acesso.html` e as páginas públicas existentes. A função inclui `private/` no seu pacote sem copiá-la para `public/`.

Não envie `.env.local`, outros arquivos `.env`, o backup `.bak`, a pasta `promisa-repository/` nem a pasta gerada `public/`. O ZIP de entrega exclui esses itens. Não copie o HTML administrativo para a pasta pública, pois isso permitiria acesso sem senha.

Framework Preset: **Other**. Build Command: `node build.mjs`. Output Directory: `public`. Node.js: **22 ou superior**. As regras de `/admin` e `/catalogo` estão em `vercel.json`; não adicione um redirecionamento geral para index.html.

## Variáveis de ambiente obrigatórias

Em Settings → Environment Variables do projeto na Vercel, configure:

| Variável | Valor |
| --- | --- |
| `ADMIN_PASSWORD` | A senha de acesso solicitada pelo responsável. Use exatamente os caracteres informados no chat, sem aspas adicionais. |
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

A validação ocorre em `api/access.js`. Abrir a entrada administrativa exige a senha novamente, sem pular automaticamente para a escolha de áreas. A sessão dura no máximo quinze minutos, usa cookie HttpOnly e SameSite=Strict, e recebe Secure na Vercel. As páginas privadas têm no-store e noindex. Alterar a senha ou o segredo invalida as sessões existentes. O limite de cinco tentativas a cada quinze minutos funciona por instância; para um limite global, será necessário armazenamento compartilhado ou regras no firewall da hospedagem.

## Armazenamento e hospedagem

O painel sincroniza dados e arquivos entre aparelhos usando Vercel Blob privado. Leia `DADOS-ONLINE.md` para conectar o recurso e enviar os dados antigos. Até o indicador mostrar Salvo online, a cópia pode existir apenas no aparelho. Importar arquivos não publica automaticamente os sites dos clientes.

## Verificação

O build, os testes locais de autenticação, a sintaxe dos scripts e as referências aos arquivos públicos foram verificados. Depois de publicar, teste rodapé, senha incorreta, as duas opções, importação de um site, catálogo e saída. Em uma janela anônima, `/admin` e `/catalogo` devem redirecionar ao login. URLs inexistentes devem retornar 404.

Os assets ausentes foram recuperados de `index.original.html.bak`. A imagem social usa uma prévia recuperada, pois o PNG social anterior não estava nesta pasta.

O código pode ser enviado ao GitHub sem segredos. A ativação online depende do armazenamento privado e de um novo deploy. A verificação visual no navegador não foi concluída: a ferramenta de prévia falhou ao inicializar neste ambiente.
