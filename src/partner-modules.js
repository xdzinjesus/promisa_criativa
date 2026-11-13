// Módulos que o dono pode liberar para um sócio, e quais dados online cada um usa.
// Usado no servidor (para bloquear de verdade) e no painel (para mostrar só as abas liberadas).
// Ficam SEMPRE só com o dono: Backup, Discord, criptografia, chaves de acesso, sócios e o uso da Vercel.
export const MODULES = [
  { id: 'dash', label: '📊 Início (números do negócio)', kinds: ['sales', 'exp', 'projects'] },
  { id: 'clients', label: '👥 Clientes e vendas', kinds: ['sales'], apis: ['briefing', 'diagnostico'] },
  { id: 'entregas', label: '✅ Entregas', kinds: ['sales'] },
  { id: 'mySites', label: '🌐 Meus sites (sites, links de demonstração, publicar)', kinds: ['sites', 'sitefiles'], settings: ['siteHostingBaseUrl', 'demoMessage'], apis: ['share', 'featured', 'publish'] },
  { id: 'projects', label: '📁 Projetos', kinds: ['projects', 'attachments'] },
  { id: 'plano', label: '🎯 Plano e despesas', kinds: ['exp'], settings: ['plan'] },
  { id: 'notes', label: '📝 Anotações', settings: ['prospectNotes'] },
  { id: 'prompts2', label: '🤖 Prompts de IA' },
  { id: 'instagram', label: '📸 Instagram', apis: ['instagram'] },
  { id: 'clientPanel', label: '🧩 Painel do cliente (montar sites)', kinds: ['sites', 'sitefiles'], apis: ['publish'] },
  { id: 'clientAccess', label: '🔐 Acessos dos clientes', apis: ['clientAccess'] },
  { id: 'bank', label: '🏦 Extratos bancários', kinds: ['bank'], settings: ['bankRules'] },
  { id: 'products', label: '📦 Produtos físicos', kinds: ['products'] },
];
export const MODULE_IDS = MODULES.map(m => m.id);
export const OWNER_ONLY_TABS = ['backup', 'partners'];

export const cleanModules = list => [...new Set((Array.isArray(list) ? list : []).filter(id => MODULE_IDS.includes(id)))];

// O que um sócio com estes módulos pode ver/gravar online.
export function accessFor(modules) {
  const ids = cleanModules(modules), chosen = MODULES.filter(m => ids.includes(m.id));
  const kinds = new Set(chosen.flatMap(m => m.kinds || []));
  const settings = new Set(chosen.flatMap(m => m.settings || []));
  const apis = new Set(chosen.flatMap(m => m.apis || []));
  return {
    modules: ids,
    // Chave de registro online, ex.: "sales:123", "settings:plan".
    allowKey(key) {
      const split = String(key).indexOf(':');
      if (split < 1) return false;
      const kind = key.slice(0, split);
      if (kind === 'settings') { try { return settings.has(decodeURIComponent(key.slice(split + 1))); } catch { return false; } }
      return kinds.has(kind);
    },
    api: name => apis.has(name),
  };
}
