// المستخدم الحالي من كوكي الجلسة + قاعدة البيانات، والتحقق من الصلاحيات على الخادم.
import { cookies } from 'next/headers';
import { getDb } from './db.js';
import { SESSION_COOKIE, SESSION_DAYS, verifySessionToken, passwordTag, createSessionToken } from './session.js';
import { ENTITY_NAMES } from './derive.js';

export const ROLE_LABELS = { tpa: 'إدارة TPA', entity: 'جهة العمل', printer: 'المطبعة' };

export async function currentUser() {
  const store = await cookies();
  const data = verifySessionToken(store.get(SESSION_COOKIE)?.value);
  if (!data) return null;
  const u = await (await getDb()).get('SELECT id, username, display_name, role, entity_id, password_hash FROM users WHERE id = ? AND active = 1', [data.uid]);
  if (!u || data.pv !== passwordTag(u.password_hash)) return null;
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    entityId: u.entity_id,
    entityName: u.entity_id ? ENTITY_NAMES[u.entity_id] : null,
  };
}

export class AuthError extends Error {
  constructor(message, status = 403) {
    super(message);
    this.status = status;
  }
}

export async function requireUser(roles) {
  const u = await currentUser();
  if (!u) throw new AuthError('يلزم تسجيل الدخول.', 401);
  if (roles && !roles.includes(u.role)) throw new AuthError('ليست لديك صلاحية لهذه العملية.');
  return u;
}

// الجهة التي يعمل عليها المستخدم: مستخدم الجهة مقيّد بجهته، وTPA يختار.
export function scopeEntity(user, requested) {
  if (user.role === 'entity') return user.entityId;
  const n = Number(requested);
  return [1, 2, 3].includes(n) ? n : null;
}

// يكتب كوكي الجلسة (عند الدخول، وبعد تغيير المستخدم كلمة مروره حتى يبقى داخلًا).
export async function startSession(userId, passwordHash) {
  (await cookies()).set(SESSION_COOKIE, createSessionToken(userId, passwordHash), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  });
}

export function actorName(user) {
  return `${user.displayName} (${user.username})`;
}
