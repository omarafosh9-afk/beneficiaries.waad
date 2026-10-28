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

// بصمة كلمة المرور داخل الجلسة: تغيير كلمة المرور يُبطل كل الجلسات السابقة لهذا الحساب.
export function passwordTag(hash) {
  return crypto.createHash('sha256').update(String(hash)).digest('base64url').slice(0, 16);
}

export function createSessionToken(userId, hash) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, pv: passwordTag(hash), exp: Date.now() + SESSION_DAYS * 864e5 })).toString('base64url');
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

// PBKDF2-SHA256 (أخف من scrypt حتى يناسب حد المعالجة في Cloudflare Workers المجانية).
// التحقق يقبل أيضا كلمات المرور القديمة المشفرة بـ scrypt.
const PBKDF2_ITER = Number(process.env.PBKDF2_ITERATIONS || 20000);

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(String(password), salt, PBKDF2_ITER, 32, 'sha256');
  return `pbkdf2$${PBKDF2_ITER}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function checkPassword(password, stored) {
  const parts = String(stored || '').split('$');
  let hash;
  let expected;
  if (parts[0] === 'pbkdf2' && parts.length === 4) {
    expected = Buffer.from(parts[3], 'hex');
    hash = crypto.pbkdf2Sync(String(password), Buffer.from(parts[2], 'hex'), Number(parts[1]), expected.length, 'sha256');
  } else if (parts[0] === 'scrypt' && parts.length === 3) {
    expected = Buffer.from(parts[2], 'hex');
    hash = crypto.scryptSync(String(password), Buffer.from(parts[1], 'hex'), 64);
  } else return false;
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}
