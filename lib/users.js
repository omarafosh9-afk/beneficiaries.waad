// إدارة المستخدمين: الإضافة، وتصفير كلمة المرور، والإيقاف والتفعيل.
import crypto from 'node:crypto';
import { getDb, nowIso } from './db.js';
import { hashPassword } from './session.js';
import { ENTITY_NAMES } from './derive.js';
import { UserError } from './beneficiaries.js';

export const ROLES = ['tpa', 'entity'];

export async function listUsers() {
  const rows = await (await getDb()).all('SELECT id, username, display_name, role, entity_id, active, created_at FROM users ORDER BY role, entity_id, username');
  return rows.map((u) => ({ ...u, entity: u.entity_id ? ENTITY_NAMES[u.entity_id] : '' }));
}

// كلمة مرور مؤقتة سهلة القراءة (بلا أحرف متشابهة).
export function tempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(10), (b) => chars[b % chars.length]).join('');
}

function validate({ username, displayName, role, entityId }) {
  const u = String(username || '').trim();
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(u)) throw new UserError('اسم المستخدم من 3 إلى 32 حرفًا إنجليزيًا أو أرقام (مسموح . _ -).');
  const name = String(displayName || '').trim();
  if (!name || name.length > 60) throw new UserError('اكتب اسم العرض (حتى 60 حرفًا).');
  if (!ROLES.includes(role)) throw new UserError('نوع المستخدم غير صحيح.');
  const eid = role === 'entity' ? Number(entityId) : null;
  if (role === 'entity' && !ENTITY_NAMES[eid]) throw new UserError('اختر الجهة.');
  return { u, name, eid };
}

export async function createUser(input) {
  const { u, name, eid } = validate(input);
  const db = await getDb();
  if (await db.get('SELECT 1 x FROM users WHERE username = ?', [u])) throw new UserError('اسم المستخدم مستخدم من قبل.');
  const password = tempPassword();
  await db.run('INSERT INTO users (username, display_name, role, entity_id, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [u, name, input.role, eid, hashPassword(password), nowIso()]);
  return { username: u, password };
}

export async function resetPassword(id) {
  const db = await getDb();
  const user = await db.get('SELECT username FROM users WHERE id = ?', [Number(id)]);
  if (!user) throw new UserError('المستخدم غير موجود.');
  const password = tempPassword();
  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(password), Number(id)]);
  return { username: user.username, password };
}

export async function setActive(id, active, selfId) {
  if (Number(id) === Number(selfId) && !active) throw new UserError('لا يمكنك إيقاف حسابك أنت.');
  await (await getDb()).run('UPDATE users SET active = ? WHERE id = ?', [active ? 1 : 0, Number(id)]);
}
