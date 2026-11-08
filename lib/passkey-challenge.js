import { createHmac, timingSafeEqual } from 'node:crypto';

// Desafio do WebAuthn sem estado no servidor: vai num cookie assinado (HttpOnly) de 5 minutos.
export const CHALLENGE_COOKIE = 'promisa_webauthn';
export const CHALLENGE_TTL = 300;

const sign = (payload, secret) => createHmac('sha256', secret + 'webauthn').update(payload).digest('base64url');

export function signChallenge({ challenge, type, now = Date.now() }, secret) {
  const payload = Buffer.from(JSON.stringify({ c: challenge, t: type, exp: Math.floor(now / 1000) + CHALLENGE_TTL })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

// Devolve o desafio se a assinatura, o tipo e a validade conferem; senão null.
export function readChallenge(cookieHeader, type, secret, now = Date.now()) {
  const raw = String(cookieHeader || '').split(';').map(x => x.trim()).find(x => x.startsWith(CHALLENGE_COOKIE + '='))?.slice(CHALLENGE_COOKIE.length + 1);
  if (!raw || raw.length > 1024) return null;
  const [payload, signed, extra] = raw.split('.');
  if (!payload || !signed || extra) return null;
  const expected = Buffer.from(sign(payload, secret)), given = Buffer.from(signed);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.t !== type || typeof data.c !== 'string' || !data.c || !Number.isInteger(data.exp) || data.exp <= Math.floor(now / 1000)) return null;
    return { challenge: data.c, exp: data.exp };
  } catch { return null; }
}

// Melhor esforço por instância: um desafio já usado não vale de novo.
export function createUsedChallenges() {
  const used = new Map();
  return {
    // true se ainda não tinha sido usado (e passa a constar como usado).
    consume(challenge, exp, now = Date.now()) {
      for (const [key, until] of used) if (until <= now) used.delete(key);
      if (used.has(challenge)) return false;
      used.set(challenge, exp * 1000);
      return true;
    }
  };
}

export function challengeCookie(value, { secure, clear = false }) {
  return `${CHALLENGE_COOKIE}=${clear ? '' : value}; HttpOnly; SameSite=Strict; Path=/api/access; Max-Age=${clear ? 0 : CHALLENGE_TTL}${secure ? '; Secure' : ''}`;
}
