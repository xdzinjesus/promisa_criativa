// Pacote do painel do dono: editor ("🧩 Painel do cliente") + controle de acessos ("🔐 Acessos dos clientes").
// A página pública do cliente (client-portal.js) importa só o editor, sem o controle.
import './client-editor.js';
import './site-data-panel.js';
import { mountControl } from './client-access-ui.js';
import { NICHES, PLANS } from './client-site-templates.js';

window.promisaClientAccess = { mountControl: root => mountControl(root, { niches: NICHES, plans: PLANS }) };
