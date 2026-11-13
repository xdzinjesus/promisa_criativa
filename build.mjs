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
for (const file of ['index.html', 'privacidade.html', '404.html', 'acesso.html', 'briefing.html', 'meu-site.html']) {
 const html = (await readFile(file, 'utf8')).replaceAll('__SITE_URL__', origin);
 await writeFile(`public/${file}`, html);
}
await cp('assets', 'public/assets', { recursive: true });
await build({ entryPoints: ['src/cloud-client.js'], bundle: true, minify: true, platform: 'browser', target: ['es2022'], outfile: 'public/assets/cloud.js' });
await build({ entryPoints: ['src/panel-security.js'], bundle: true, minify: true, platform: 'browser', target: ['es2022'], outfile: 'public/assets/security.js' });
await build({ entryPoints: ['src/briefing-page.js'], bundle: true, minify: true, platform: 'browser', target: ['es2022'], outfile: 'public/assets/briefing.js' });
await build({ entryPoints: ['src/briefing-panel.js'], bundle: true, minify: true, platform: 'browser', target: ['es2022'], outfile: 'public/assets/briefing-panel.js' });
await build({ entryPoints: ['src/plan-prompts-panel.js'], bundle: true, minify: true, platform: 'browser', target: ['es2022'], outfile: 'public/assets/plan-prompts.js' });
await build({ entryPoints: ['src/vault-login.js'], bundle: true, minify: true, platform: 'browser', target: ['es2022'], outfile: 'public/assets/vault-login.js' });
await build({ entryPoints: ['src/passkey-login.js'], bundle: true, minify: true, platform: 'browser', target: ['es2022'], outfile: 'public/assets/passkey.js' });
await build({ entryPoints: ['src/passkey-panel.js'], bundle: true, minify: true, platform: 'browser', target: ['es2022'], outfile: 'public/assets/passkey-panel.js' });
await build({ entryPoints: ['src/discord-panel.js'], bundle: true, minify: true, platform: 'browser', target: ['es2022'], outfile: 'public/assets/discord-panel.js' });
await build({ entryPoints: ['src/client-helpers-panel.js'], bundle: true, minify: true, platform: 'browser', target: ['es2022'], outfile: 'public/assets/client-helpers.js' });
await build({ entryPoints: ['src/panel-chrome.js'], bundle: true, minify: true, platform: 'browser', target: ['es2022'], outfile: 'public/assets/panel-chrome.js' });
await build({ entryPoints: ['src/client-portal.js'], bundle: true, minify: true, platform: 'browser', target: ['es2022'], outfile: 'public/assets/client-portal.js' });
await build({ entryPoints: ['src/client-panel-entry.js'], bundle: true, minify: true, platform: 'browser', target: ['es2022'], outfile: 'public/assets/client-editor.js' });
await build({ entryPoints: ['src/site-backup.js'], bundle: true, minify: true, platform: 'browser', target: ['es2022'], outfile: 'public/assets/site-backup.js' });
await build({ entryPoints: ['src/instagram-panel.js'], bundle: true, minify: true, platform: 'browser', target: ['es2022'], outfile: 'public/assets/instagram-panel.js' });
await writeFile('public/robots.txt', `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /catalogo\nDisallow: /acesso.html\nDisallow: /api/\nDisallow: /demo/\nDisallow: /projeto/\nDisallow: /briefing/\nDisallow: /diagnostico/\nDisallow: /briefing.html\nDisallow: /meu-site/\nDisallow: /meu-site.html\nSitemap: ${origin}/sitemap.xml\n`);
await writeFile('public/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url><url><loc>${origin}/privacidade.html</loc></url></urlset>\n`);
console.log(`Site gerado para ${origin}`);
