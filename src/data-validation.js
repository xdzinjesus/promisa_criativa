const ID = /^[A-Za-z0-9_.~-]{1,180}$/;
const collections = new Set(['sales', 'exp', 'projects', 'sites', 'attachments']);
const settings = new Set(['prospectNotes', 'siteHostingBaseUrl', 'plan', 'demoMessage']);
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
export function validId(id) { return (typeof id === 'string' || Number.isSafeInteger(id)) && ID.test(String(id)); }
export function safeFilePath(path) {
  return typeof path === 'string' && path.length <= 1024 && !/[\x00-\x1f\\]/.test(path) && !path.startsWith('/') && path.split('/').every(part => part && part !== '.' && part !== '..' && part !== '.git' && !/^\.env(?:\.|$)/i.test(part) && !/\.(?:pem|key)$/i.test(part));
}
export function assertSafeTree(value, depth = 0) {
  if (depth > 30) throw new Error('Dados com estrutura excessivamente profunda.');
  if (value instanceof Blob || value === null || typeof value !== 'object') return;
  if (Array.isArray(value) && value.length > 10000) throw new Error('Lista excessivamente grande.');
  for (const key of Object.keys(value)) {
    if (forbidden.has(key)) throw new Error('Campo inseguro no arquivo importado.');
    assertSafeTree(value[key], depth + 1);
  }
}
function text(value, name, limit = 2 * 1024 * 1024) {
  if (value !== undefined && (typeof value !== 'string' || value.length > limit)) throw new Error(`Campo inválido: ${name}.`);
}
export function validateRecord(kind, raw, expectedId, { encoded = false } = {}) {
  const blob = value => value instanceof Blob || encoded && value?.__promisaBlob === 1 && typeof value.type === "string" && typeof value.base64 === "string" && value.base64.length % 4 === 0 && !/[^A-Za-z0-9+/=]/.test(value.base64) && !value.base64.slice(0,-2).includes('=');
  assertSafeTree(raw);
  if (!collections.has(kind) || !raw || Array.isArray(raw) || typeof raw !== 'object' || !validId(raw.id)) throw new Error('Registro ou identificador inválido.');
  if (expectedId !== undefined && String(raw.id) !== String(expectedId)) throw new Error('O identificador não corresponde ao registro.');
  const value = { ...raw, id: String(raw.id) };
  for (const name of ['title', 'name', 'client', 'contact', 'service', 'desc', 'description', 'notes', 'status', 'stage', 'date', 'dueDate', 'createdAt', 'updatedAt', 'clientName', 'slug', 'demoSentAt', 'demoUrl', 'briefingToken', 'briefingSentAt']) text(value[name], name);
  for (const name of ['leadId', 'projectId', 'siteId', 'sourceId']) if (value[name] !== undefined && value[name] !== '' && !validId(value[name])) throw new Error(`Vínculo inválido: ${name}.`);
  for (const name of ['value', 'size']) if (value[name] !== undefined && (typeof value[name] !== 'number' || !Number.isFinite(value[name]) || value[name] < 0)) throw new Error(`Número inválido: ${name}.`);
  if (value.featured !== undefined) {
    const f = value.featured;
    if (!f || typeof f !== 'object' || Array.isArray(f) || typeof f.on !== 'boolean' || typeof f.demo !== 'boolean' || typeof f.title !== 'string' || f.title.length > 60 || typeof f.category !== 'string' || f.category.length > 60 || !Number.isInteger(f.order) || f.order < 1 || f.order > 6) throw new Error('Destaque do site inválido.');
  }
  if (value.paid !== undefined && typeof value.paid !== 'boolean') throw new Error('Situação de pagamento inválida.');
  if (kind === 'sites') {
    if (!Array.isArray(value.files) || !value.files.length || value.files.length > 5000 || !safeFilePath(value.htmlPath)) throw new Error('Arquivos do site inválidos.');
    const paths = new Set();
    for (const file of value.files) {
      if (!file || !safeFilePath(file.path) || paths.has(file.path) || typeof file.data !== 'string') throw new Error('Caminho duplicado/inseguro ou conteúdo inválido. Não importe .env, .git ou chaves privadas.');
      paths.add(file.path); text(file.type, 'tipo de arquivo', 200);
    }
    if (!paths.has(value.htmlPath)) throw new Error('A página principal não está no arquivo.');
    if (value.sourceZip && (!blob(value.sourceZip.blob) || typeof value.sourceZip.name !== 'string')) throw new Error('ZIP original inválido.');
  }
  if (kind === 'attachments' && !blob(value.blob)) throw new Error('Conteúdo do anexo inválido.');
  return value;
}
export function validateSetting(name, value) {
  assertSafeTree(value);
  if (!settings.has(name)) throw new Error('Configuração desconhecida.');
  if (name === 'plan') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Plano inválido.');
    for (const [key, item] of Object.entries(value)) {
      if (!['meta', 'ticket', 'conv', 'pacotes', 'publico', 'dif', 'obs'].includes(key)) throw new Error('Campo desconhecido no plano.');
      text(item, key);
    }
  } else {
    text(value, name, name === 'demoMessage' ? 2000 : undefined);
    if (name === 'siteHostingBaseUrl' && value) {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Domínio de hospedagem inválido.');
    }
  }
  return value;
}
export function validateEntry(key, value, options) {
  if (typeof key !== 'string' || !/^(sales|exp|projects|settings|sites|attachments):[A-Za-z0-9%_.~-]{1,180}$/.test(key)) throw new Error('Chave de registro inválida.');
  const split = key.indexOf(':'), kind = key.slice(0, split), id = decodeURIComponent(key.slice(split + 1));
  if (value === undefined) return value;
  return kind === 'settings' ? validateSetting(id, value) : validateRecord(kind, value, id, options);
}
export function validateState(raw) {
  assertSafeTree(raw);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Backup de dados inválido.');
  const result = {};
  for (const [name, value] of Object.entries(raw)) {
    if (['sales', 'exp', 'projects'].includes(name)) {
      if (!Array.isArray(value) || value.length > 5000) throw new Error('Coleção inválida.');
      result[name] = value.map(item => validateRecord(name, item));
      if (new Set(result[name].map(item => item.id)).size !== result[name].length) throw new Error('Identificadores duplicados.');
    } else result[name] = validateSetting(name, value);
  }
  if (!Array.isArray(result.sales) || !Array.isArray(result.exp)) throw new Error('Backup incompleto.');
  return result;
}
