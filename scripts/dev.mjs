import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import handler from '../api/access.js';
import cloudHandler from '../api/cloud.js';
import demoHandler from '../api/demo.js';
import featuredHandler from '../api/featured.js';
import briefingHandler from '../api/briefing.js';

const root = resolve('public');
const config = JSON.parse(await readFile('vercel.json', 'utf8'));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const demo = /^\/demo\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
    if (demo) { let path = demo[2] || ''; try { path = decodeURIComponent(path); } catch { path = ''; } req.query = { token: demo[1], path }; return await demoHandler(req, res); }
    const project = /^\/projeto\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
    if (project) { let path = project[2] || ''; try { path = decodeURIComponent(path); } catch { path = ''; } req.query = { mode: 'site', id: project[1], path }; return await featuredHandler(req, res); }
    if (url.pathname === '/api/featured') { req.query = {}; return await featuredHandler(req, res); }
    if (url.pathname === '/api/briefing') { req.query = Object.fromEntries(url.searchParams); return await briefingHandler(req, res); }
    if (/^\/briefing\/[^/]+\/?$/.test(url.pathname)) url.pathname = '/briefing.html';
    const route = config.rewrites.find(item => item.source === url.pathname);
    if (url.pathname === '/api/access' || url.pathname === '/api/cloud' || route) {
      const destination = new URL(route?.destination || req.url, 'http://localhost');
      req.query = Object.fromEntries([...url.searchParams, ...destination.searchParams]);
      if (req.method === 'POST') {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 4 * 1024 * 1024) { res.writeHead(413).end(); return; }
        }
        req.body = body;
      }
      return await (url.pathname === '/api/cloud' ? cloudHandler : handler)(req, res);
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    for (const group of config.headers) {
      if (group.source === '/(.*)' || group.source === url.pathname) for (const header of group.headers) res.setHeader(header.key, header.value);
    }
    const path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(root + sep)) { res.writeHead(404).end(); return; }
    try {
      const content = await readFile(path);
      res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(await readFile(resolve(root, '404.html'))); }
  } catch { res.writeHead(500).end('Erro no servidor de desenvolvimento.'); }
});
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${server.address().port}`));
