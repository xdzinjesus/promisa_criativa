// Resumo do visitante de um link de demonstração: tipo de aparelho, navegador e cidade aproximada.
// Nunca usa nem devolve o IP (dado pessoal desnecessário para saber se a demonstração foi vista).
const clip = (value, max) => String(value || '').replace(/[\u0000-\u001f<>@`*_~|\\]/g, '').trim().slice(0, max);

export function deviceFromUA(ua) {
  ua = String(ua || '');
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua))) return '📱 iPad';
  if (/iPhone/.test(ua)) return '📱 iPhone';
  if (/Android/.test(ua)) {
    const model = /Android [\d.]+;\s*(?:[a-z]{2}[-_][A-Za-z]{2};\s*)?([^;)]+?)(?:\s+Build\/|\))/.exec(ua)?.[1]?.trim();
    const brand = /SM-|Samsung/i.test(ua) ? 'Samsung' : /Moto|XT\d/i.test(ua) ? 'Motorola' : /Redmi|Xiaomi|POCO|M\d{4}/i.test(ua) ? 'Xiaomi' : '';
    const label = model && model !== 'K' && !/^Linux/.test(model) ? clip(model, 30) : '';
    return '📱 Android' + (brand ? ' ' + brand : '') + (label && !label.includes(brand) ? ` (${label})` : '');
  }
  if (/Windows/.test(ua)) return '💻 Computador Windows';
  if (/Macintosh|Mac OS X/.test(ua)) return '💻 Mac';
  if (/CrOS/.test(ua)) return '💻 Chromebook';
  if (/Linux/.test(ua)) return '💻 Computador Linux';
  if (/bot|crawler|spider|preview|WhatsApp|facebookexternalhit|TelegramBot|Slackbot|Discordbot/i.test(ua)) return '🤖 Prévia de link (robô)';
  return '❔ Aparelho desconhecido';
}

export function browserFromUA(ua) {
  ua = String(ua || '');
  if (/Instagram/.test(ua)) return 'Instagram';
  if (/FBAN|FBAV|FB_IAB/.test(ua)) return 'Facebook';
  if (/WhatsApp/.test(ua)) return 'WhatsApp';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/SamsungBrowser/.test(ua)) return 'Samsung Internet';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/CriOS|Chrome\//.test(ua)) return 'Chrome';
  if (/FxiOS|Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua)) return 'Safari';
  return '';
}

const decode = value => { try { return decodeURIComponent(String(value || '')); } catch { return String(value || ''); } };

export function visitorFromHeaders(headers = {}) {
  const get = name => { const v = headers[name]; return Array.isArray(v) ? v[0] : v; };
  const ua = get('user-agent');
  const city = clip(decode(get('x-vercel-ip-city')), 60);
  const region = clip(get('x-vercel-ip-country-region'), 10);
  const country = clip(get('x-vercel-ip-country'), 4);
  const place = city ? `${city}${region ? '/' + region : ''}${country && country !== 'BR' ? ' · ' + country : ''}` : (country && country !== 'BR' ? country : '');
  const bot = /bot|crawler|spider|preview|WhatsApp\/|facebookexternalhit|TelegramBot|Slackbot|Discordbot/i.test(String(ua || '')) && !/iPhone|Android.*Mobile/.test(String(ua || '')) ;
  return { device: bot ? '🤖 Prévia de link (robô)' : deviceFromUA(ua), browser: bot ? '' : browserFromUA(ua), place, bot };
}
