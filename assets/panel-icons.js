// Troca os emojis do painel por ícones desenhados (traço fino, mesmo estilo do menu).
// Funciona em tudo que aparece na tela, inclusive módulos e avisos, sem mexer nos dados salvos.
// Campos de digitar (input/textarea) não são tocados; em listas de opção (<select>) o emoji só é removido.
(() => {
  'use strict';
  const P = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    checkc: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    xc: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6"/>',
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
    bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
    cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.6L22 7H6"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
    sparkles: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.1 2.1M15.6 15.6l2.1 2.1M6.3 17.7l2.1-2.1M15.6 8.4l2.1-2.1"/>',
    award: '<circle cx="12" cy="9" r="6"/><path d="m8.5 14.2-1.5 7.8 5-3 5 3-1.5-7.8"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 9.2-9.2M17 6l3 3M14 9l2 2"/>',
    puzzle: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    hourglass: '<path d="M6 2h12M6 22h12M7 2v4l5 6-5 6v4M17 2v4l-5 6 5 6v4"/>',
    camera: '<path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="4"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    video: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m16 10 6-3v10l-6-3"/>',
    users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 9M22 21a7 7 0 0 0-4-6.3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    handshake: '<path d="m11 17 2 2a1.4 1.4 0 0 0 2-2M14 14l2.5 2.5a1.4 1.4 0 0 0 2-2l-3.9-3.9a3 3 0 0 0-4.2 0l-.9.9a1.4 1.4 0 0 1-2-2l2.8-2.8a5 5 0 0 1 5.4-1.1l.6.3a2 2 0 0 0 1.5.1L21 5M3 4l2 .6a2 2 0 0 1 1.3 1.1L9 11M3 14l5 5a1.4 1.4 0 0 0 2-2"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
    call: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
    clipboard: '<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 4V2.5h6V4M9 11h6M9 15h4"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
    bank: '<path d="M3 21h18M5 21V10M10 21V10M14 21V10M19 21V10M2 10l10-6 10 6z"/>',
    trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    trenddown: '<path d="m3 7 6 6 4-4 8 8"/><path d="M15 17h6v-6"/>',
    bars: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.3L3 16M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M3 21v-5h5"/>',
    wallet: '<rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20M16 15h2M6 6V4.5A1.5 1.5 0 0 1 7.5 3H18"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13v1M15 13v1M2 14h2M20 14h2"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>',
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 0 1 0 9z"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
    rocket: '<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1z"/><path d="m12 15-3-3a22 22 0 0 1 2-4A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path d="M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
    pulse: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    bulb: '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    dot: '<circle cx="12" cy="12" r="5" fill="currentColor"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/>',
    radio: '<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19.1 4.9a10 10 0 0 1 0 14.2M4.9 19.1a10 10 0 0 1 0-14.2"/>',
    shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
    palette: '<circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2a10 10 0 0 0 0 20c1 0 1.7-.8 1.7-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.8-1.7 1.7-1.7h2A5.6 5.6 0 0 0 22 11c0-5-4.5-9-10-9z"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
    hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    wave: '<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>',
    instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>',
  };
  // Emoji → [ícone, tom]. Tom: ok (verde), warn (amarelo), bad (vermelho), led (roxo), '' (cor do texto).
  const M = {
    '✅': ['checkc', 'ok'], '✓': ['check', 'ok'], '✔': ['check', 'ok'], '🟢': ['dot', 'ok'], '🟩': ['dot', 'ok'], '🟡': ['dot', 'warn'], '🔴': ['dot', 'bad'], '🟥': ['dot', 'bad'],
    '⚠': ['alert', 'warn'], '⛔': ['ban', 'bad'], '❌': ['xc', 'bad'], '✖': ['xc', 'bad'],
    '📦': ['box', 'led'], '🛍': ['bag', 'led'], '🛒': ['cart', 'led'], '🌐': ['globe', 'led'], '⭐': ['star', 'warn'], '✨': ['sparkles', 'led'], '✦': ['sparkles', 'led'], '🎉': ['sparkles', 'led'],
    '🏆': ['award', 'warn'], '🥇': ['award', 'warn'], '🥈': ['award', ''], '🥉': ['award', ''],
    '🔐': ['lock', 'led'], '🔒': ['lock', 'led'], '🔑': ['key', 'led'], '🧩': ['puzzle', 'led'],
    '⏳': ['hourglass', 'warn'], '⏰': ['clock', 'warn'], '🕓': ['clock', ''], '🕒': ['clock', ''],
    '📷': ['camera', 'led'], '📸': ['instagram', 'led'], '🎬': ['video', 'led'], '🎥': ['video', 'led'], '🖼': ['image', 'led'],
    '👥': ['users', 'led'], '👤': ['user', 'led'], '🙋': ['user', 'led'], '🤝': ['handshake', 'led'], '👋': ['wave', 'led'],
    '🧭': ['compass', 'led'], '💬': ['chat', 'led'], '📞': ['call', 'led'], '📲': ['phone', 'led'], '📱': ['phone', 'led'],
    '📋': ['clipboard', 'led'], '🧾': ['file', 'led'], '📝': ['edit', 'led'], '✏': ['edit', 'led'], '📄': ['file', 'led'], '📖': ['book', 'led'], '📘': ['book', 'led'], '🔖': ['tag', 'led'], '🏷': ['tag', 'led'],
    '🏦': ['bank', 'led'], '📈': ['trend', 'ok'], '📉': ['trenddown', 'bad'], '📊': ['bars', 'led'],
    '📤': ['upload', 'led'], '📥': ['download', 'led'], '⬇': ['download', 'led'], '🔄': ['refresh', 'led'], '🔁': ['refresh', 'led'],
    '💰': ['wallet', 'ok'], '🔗': ['link', 'led'], '👁': ['eye', 'led'], '➕': ['plus', 'led'], '🎯': ['target', 'led'], '🤖': ['bot', 'led'],
    '📅': ['calendar', 'led'], '🗓': ['calendar', 'led'], '🗑': ['trash', 'bad'], '☁': ['cloud', 'led'], '💾': ['save', 'led'], '🚀': ['rocket', 'led'],
    '⚡': ['zap', 'warn'], '🩺': ['pulse', 'led'], '💡': ['bulb', 'warn'], '❓': ['help', 'led'], '⏸': ['pause', 'warn'],
    '🔧': ['settings', 'led'], '⚙': ['settings', 'led'], '📁': ['folder', 'led'], '🗂': ['folder', 'led'], '❤': ['heart', 'bad'], '💜': ['heart', 'led'],
    '📡': ['radio', 'led'], '🎲': ['shuffle', 'led'], '🎨': ['palette', 'led'], '🪜': ['layers', 'led'], '🔢': ['hash', 'led'], '🖥': ['monitor', 'led'], '📭': ['inbox', 'led'], '🔍': ['search', 'led'],
  };
  // Mantidos como estão: são símbolos de texto, não emojis (fechar, setas, atalho).
  const KEEP = new Set(['✕', '⌘', '↗', '←', '→', '↑', '↓', '▾', '▸', '•', '·']);
  const RE = /(?:\p{Extended_Pictographic}|[☀-➿⬀-⯿])(?:️|‍\p{Extended_Pictographic}️?)*/gu;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'NOSCRIPT', 'CODE', 'PRE', 'svg', 'SVG', 'IFRAME']);
  const icon = (ch) => {
    const base = ch.replace(/️/g, '').replace(/‍.*/u, '');
    const [name, tone] = M[base] || ['dot', 'led'];
    const span = document.createElement('span');
    span.className = 'pi' + (tone ? ' pi-' + tone : '') + (M[base] ? '' : ' pi-unknown');
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${P[name]}</svg>`;
    return span;
  };
  const strip = s => s.replace(RE, m => KEEP.has(m) ? m : '').replace(/\s{2,}/g, ' ');
  const hasEmoji = s => { RE.lastIndex = 0; let m; while ((m = RE.exec(s))) if (!KEEP.has(m[0])) return true; return false; };
  function fixText(node) {
    const text = node.nodeValue;
    if (!text || !hasEmoji(text)) return;
    const parent = node.parentNode;
    if (!parent || parent.closest?.('[contenteditable],.no-icons')) return;
    if (parent.nodeName === 'OPTION' || parent.nodeName === 'TITLE') { node.nodeValue = strip(text).trim(); return; }
    const frag = document.createDocumentFragment();
    let last = 0; RE.lastIndex = 0; let m;
    while ((m = RE.exec(text))) {
      if (KEEP.has(m[0])) continue;
      if (m.index > last) frag.append(text.slice(last, m.index));
      frag.append(icon(m[0]));
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.append(text.slice(last));
    parent.replaceChild(frag, node);
  }
  const ATTRS = ['placeholder', 'title', 'aria-label'];
  function fixAttrs(el) { for (const a of ATTRS) { const v = el.getAttribute?.(a); if (v && hasEmoji(v)) el.setAttribute(a, strip(v).trim()); } }
  function walk(root) {
    if (root.nodeType === 3) { if (!SKIP.has(root.parentNode?.nodeName)) fixText(root); return; }
    if (root.nodeType !== 1 || SKIP.has(root.nodeName)) return;
    fixAttrs(root);
    for (const el of root.querySelectorAll?.('[placeholder],[title],[aria-label]') || []) fixAttrs(el);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => {
      for (let p = n.parentNode; p && p !== root.parentNode; p = p.parentNode) if (SKIP.has(p.nodeName)) return NodeFilter.FILTER_REJECT;
      return hasEmoji(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    } });
    const list = []; while (tw.nextNode()) list.push(tw.currentNode);
    list.forEach(fixText);
  }
  function start() {
    walk(document.body);
    if (document.title && hasEmoji(document.title)) document.title = strip(document.title).trim();
    new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'characterData') walk(m.target);
        else if (m.type === 'attributes') fixAttrs(m.target);
        else for (const n of m.addedNodes) walk(n);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  window.promisaIcons = { walk, strip };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
