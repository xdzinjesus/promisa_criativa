# Enviar ao GitHub

## Pelo site do GitHub

1. Extraia `promisa-pronto-github.zip` em uma pasta.
2. Abra o repositório `xdzinjesus/promisa_criativa` no GitHub.
3. Use **Add file → Upload files** e envie o conteúdo extraído, mantendo as pastas `api`, `assets`, `lib`, `src`, `private`, `scripts`, `tests` e `.github`.
4. Os arquivos precisam ficar na raiz do repositório, junto ao `index.html`, sem uma pasta extra envolvendo o projeto.
5. Inclua os arquivos que começam com ponto: `.gitignore`, `.gitattributes`, `.nvmrc` e `.env.example`. Confirme o envio com **Commit changes**.

O ZIP já exclui senhas, `.env.local`, backups, o build `public/` e a pasta `.git`.

## Pelo Git no computador

A pasta `promisa-repository` é uma cópia do repositório original com os arquivos novos preparados. Entre nela no terminal:

```powershell
git status
git add .
git commit -m "Adiciona acesso administrativo e catalogo de projetos"
git push origin main
```

Nenhum commit ou push foi executado nesta preparação. O envio pode pedir que você entre na sua conta do GitHub.

## Vercel

Antes de enviar o código, configure `ADMIN_PASSWORD` com a senha solicitada e `ADMIN_SESSION_SECRET` com um segredo aleatório de pelo menos 32 caracteres em **Settings → Environment Variables**. Essas variáveis precisam estar no ambiente **Production**. Se a Vercel já está conectada à branch `main`, o envio pode iniciar uma publicação automática.

Use Framework Preset **Other**, Node.js **22.x**, Build Command `node build.mjs` e Output Directory `public`, conforme `vercel.json`.

`SITE_URL` é opcional e deve usar o domínio HTTPS real se for configurado. Não envie `.env.local` para o GitHub. Veja `PUBLICACAO.md` para os detalhes de configuração e as limitações do catálogo local.

Para compartilhar dados e anexos entre aparelhos, siga também `DADOS-ONLINE.md` e configure o Vercel Blob privado.
