// Descobre sozinho se um site feito à mão tem área administrativa, onde ela abre e como ela salva.
// Usado no servidor (ao publicar) e no painel (para mostrar o resultado). Só lê texto: nada é executado.
const WORDS = 'admin|adm|painel|gestao|gerenciar|gerencia|dashboard|restrit|login|editar|editor';
const HASH = new RegExp(`['"\`](#\\/?[\\w-]*(?:${WORDS})[\\w-]*)['"\`]`, 'gi');
const PAGE = new RegExp(`(?:^|/)([\\w-]*(?:${WORDS})[\\w-]*\\.html?)$`, 'i');

const text = file => typeof file?.data === 'string' ? file.data : '';

// files: [{ path, data (texto) }]. Retorna { hasAdmin, entry, saves: ['storage'|'download'], blocks, unsupported, external, ok }
export function detectAdmin(files = []) {
  const list = (Array.isArray(files) ? files : []).filter(f => /\.(html?|js|mjs)$/i.test(String(f?.path || '')));
  const all = list.map(text).join('\n');
  const html = list.filter(f => /\.html?$/i.test(f.path)).map(text).join('\n');
  // Onde a área abre: um "#admin" que o código compara com o endereço, ou uma página admin.html.
  const hashes = new Map();
  for (const m of all.matchAll(HASH)) {
    const near = all.slice(Math.max(0, m.index - 80), m.index + m[0].length + 80);
    const score = (/location\.hash|hashchange|href\s*=/.test(near) ? 2 : 0) + (/admin|adm|painel/i.test(m[1]) ? 1 : 0);
    hashes.set(m[1], Math.max(hashes.get(m[1]) || 0, score));
  }
  const bestHash = [...hashes.entries()].filter(([, s]) => s >= 2).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  const page = list.map(f => String(f.path).replace(/\\/g, '/')).find(p => PAGE.test(p) && !/^index\.html?$/i.test(p)) || '';
  const entry = bestHash || (page ? '/' + page.replace(/^\/+/, '') : '');
  const hasPassword = /type\s*=\s*["']password["']/i.test(all);
  const saysAdmin = /área\s+administrativa|area\s+administrativa|painel\s+(?:administrativo|de\s+controle|do\s+dono)|modo\s+admin/i.test(all);
  const hasAdmin = Boolean(entry || hasPassword || saysAdmin);
  // Como ela salva.
  const saves = [];
  if (/localStorage/.test(all)) saves.push('storage');
  const blocks = [...html.matchAll(/<script\s+type=["']application\/json["']\s+id=["']([\w-]{1,60})["']\s*>/gi)].map(m => m[1]);
  if (blocks.length && /createObjectURL/.test(all)) saves.push('download');
  const unsupported = /indexedDB\.open/.test(all) && !saves.length;
  const external = /firebase|firestore|supabase|appwrite|pocketbase/i.test(all);
  return { hasAdmin, entry, saves, blocks: [...new Set(blocks)].slice(0, 5), unsupported, external, ok: hasAdmin && saves.length > 0 && !external };
}

// Endereço que liga o modo edição: o da própria área administrativa, se achado; senão o padrão #promisa-admin.
export const editEntry = detection => detection?.entry || '#promisa-admin';
