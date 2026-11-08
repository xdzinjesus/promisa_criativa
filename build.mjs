import { mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { build } from 'esbuild';
const host = process.env.SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
if (!host) throw new Error('Defina SITE_URL com a URL pública ou execute o build na Vercel.');
const url = new URL(host.startsWith('http') ? host : `https://${host}`);
if (url.protocol !== 'https:') throw new Error('SITE_URL deve usar HTTPS.');
const origin = url.origin;
await rm('public', { recursive: true, force: true });
await mkdir('public', { recursive: true });
// Apenas páginas públicas: private/ é servido exclusivamente pela função autenticada.
for (const file of ['index.html', 'privacidade.html', '404.html', 'acesso.html']) {
 const html = (await readFile(file, 'utf8')).replaceAll('__SITE_URL__', origin);
 await writeFile(`public/${file}`, html);
}
await cp('assets', 'public/assets', { recursive: true });
await build({ entryPoints: ['src/cloud-client.js'], bundle: true, minify: true, platform: 'browser', target: ['es2022'], outfile: 'public/assets/cloud.js' });
await build({ entryPoints: ['src/panel-security.js'], bundle: true, minify: true, platform: 'browser', target: ['es2022'], outfile: 'public/assets/security.js' });
await build({ entryPoints: ['src/vault-login.js'], bundle: true, minify: true, platform: 'browser', target: ['es2022'], outfile: 'public/assets/vault-login.js' });
await writeFile('public/robots.txt', `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /catalogo\nDisallow: /acesso.html\nDisallow: /api/\nDisallow: /demo/\nSitemap: ${origin}/sitemap.xml\n`);
await writeFile('public/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url><url><loc>${origin}/privacidade.html</loc></url></urlset>\n`);
console.log(`Site gerado para ${origin}`);
