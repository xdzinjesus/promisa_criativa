let catalogEntries = [];
const search = document.getElementById('catalog-search');
const filter = document.getElementById('catalog-filter');
const grid = document.getElementById('catalog-grid');
function drawCatalog() {
  const query = search.value.trim().toLocaleLowerCase('pt-BR');
  const entries = catalogEntries.filter(item => (!filter.value || item.type === filter.value) && `${item.name} ${item.description} ${item.client}`.toLocaleLowerCase('pt-BR').includes(query));
  document.getElementById('catalog-count').textContent = `${entries.length} de ${catalogEntries.length} item(ns)`;
  grid.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'catalog-empty';
    empty.textContent = catalogEntries.length ? 'Nenhum projeto corresponde à sua busca.' : 'Seu catálogo está vazio. Cadastre projetos ou importe sites na área administrativa para vê-los aqui.';
    grid.append(empty);
    return;
  }
  for (const item of entries) {
    const card = document.createElement('article');
    card.className = 'catalog-card';
    const tag = document.createElement('small');
    tag.textContent = `${{ cliente: 'Site de cliente', pessoal: 'Meu site', projeto: 'Projeto' }[item.type]} · ${item.status}`;
    const title = document.createElement('h2'); title.textContent = item.name;
    const description = document.createElement('p'); description.textContent = item.description || 'Sem descrição.';
    card.append(tag, title, description);
    if (item.client) { const client = document.createElement('p'); client.textContent = `Cliente: ${item.client}`; card.append(client); }
    if (item.siteId && clientSiteRows.some(site => site.id === item.siteId)) {
      const preview = document.createElement('button'); preview.type = 'button'; preview.textContent = 'Visualizar site';
      preview.addEventListener('click', () => openClientSite(item.siteId)); card.append(preview);
    }
    const manage = document.createElement('a');
    manage.href = `/admin?tab=${item.type === 'projeto' ? 'projects' : item.type === 'pessoal' ? 'mySites' : 'sites'}`;
    manage.textContent = 'Gerenciar na área administrativa →'; card.append(manage);
    grid.append(card);
  }
}
async function loadCatalog() {
  try {
    clientSiteRows = await clientSiteAll();
    // A aba de gestão pode ter alterado os projetos desde a abertura deste catálogo.
    try { const latest = JSON.parse(localStorage.getItem(K) || '{}'); if (Array.isArray(latest.projects)) S.projects = latest.projects; } catch {}
    catalogEntries = [
      ...clientSiteRows.map(site => ({ name: site.name || 'Site sem nome', description: site.description || '', client: site.clientName || '', status: site.status || 'Em edição', type: site.siteType === 'pessoal' ? 'pessoal' : 'cliente', siteId: site.id, updated: site.updatedAt || '' })),
      ...(S.projects || []).map(project => ({ name: project.title || 'Projeto sem nome', description: project.notes || '', client: '', status: project.status || 'Em andamento', type: 'projeto', siteId: project.siteId || '', updated: project.updatedAt || '' }))
    ].sort((a, b) => b.updated.localeCompare(a.updated));
    drawCatalog();
  } catch {
    grid.textContent = 'Não foi possível abrir a biblioteca neste navegador. Verifique se o armazenamento local está habilitado e recarregue a página.';
  }
}
search.addEventListener('input', drawCatalog);
filter.addEventListener('change', drawCatalog);
window.addEventListener('focus', loadCatalog);
loadCatalog();
