// توقيع والتحقق من كوكي الجلسة (HMAC-SHA256) - بلا قاعدة بيانات، حتى يستعمله proxy.js.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SESSION_COOKIE = 'bv_session';
export const SESSION_DAYS = 7;

function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (globalThis.__bvSecret) return globalThis.__bvSecret;
  // بلا SESSION_SECRET: سر يُنشأ مرة ويُحفظ داخل مجلد البيانات.
  const dir = path.resolve(process.env.DATA_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), 'data'));
  const file = path.join(dir, '.session-secret');
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  globalThis.__bvSecret = fs.readFileSync(file, 'utf8').trim();
  return globalThis.__bvSecret;
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function createSessionToken(userId) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + SESSION_DAYS * 864e5 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.uid || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function checkPassword(password, stored) {
  const [kind, saltHex, hashHex] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}
