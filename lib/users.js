// إدارة المستخدمين: الإضافة، وتصفير كلمة المرور، والإيقاف والتفعيل.
import crypto from 'node:crypto';
import { getDb, nowIso } from './db.js';
import { hashPassword, checkPassword } from './session.js';
import { ENTITY_NAMES } from './derive.js';
import { UserError } from './beneficiaries.js';

export const ROLES = ['tpa', 'entity', 'printer'];

export async function listUsers() {
  const rows = await (await getDb()).all('SELECT id, username, display_name, role, entity_id, active, created_at FROM users ORDER BY role, entity_id, username');
  return rows.map((u) => ({ ...u, entity: u.entity_id ? ENTITY_NAMES[u.entity_id] : '' }));
}

// كلمة مرور مؤقتة بسيطة: 6 أرقام، يغيّرها المستخدم بنفسه من «كلمة المرور».
export function tempPassword() {
  return String(crypto.randomInt(0, 1e6)).padStart(6, '0');
}

export const MIN_PASSWORD = 4;

// تغيير المستخدم كلمة مروره بنفسه بعد التحقق من الحالية.
export async function changeOwnPassword(userId, current, next) {
  const db = await getDb();
  const u = await db.get('SELECT password_hash FROM users WHERE id = ?', [Number(userId)]);
  if (!u || !checkPassword(String(current || ''), u.password_hash)) throw new UserError('كلمة المرور الحالية غير صحيحة.');
  const p = String(next || '');
  if (p.length < MIN_PASSWORD || p.length > 64) throw new UserError(`كلمة المرور الجديدة من ${MIN_PASSWORD} إلى 64 حرفًا.`);
  const hash = hashPassword(p);
  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, Number(userId)]);
  return hash;
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

function checkNewPassword(password) {
  const p = String(password || '');
  if (p.length < MIN_PASSWORD || p.length > 64) throw new UserError(`كلمة المرور من ${MIN_PASSWORD} إلى 64 حرفًا.`);
  return p;
}

// إنشاء مستخدم: كلمة المرور يحددها المدير، أو تُولَّد مؤقتة (6 أرقام) إن تُركت فارغة.
export async function createUser(input) {
  const { u, name, eid } = validate(input);
  const db = await getDb();
  if (await db.get('SELECT 1 x FROM users WHERE username = ?', [u])) throw new UserError('اسم المستخدم مستخدم من قبل.');
  const password = input.password ? checkNewPassword(input.password) : tempPassword();
  await db.run('INSERT INTO users (username, display_name, role, entity_id, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [u, name, input.role, eid, hashPassword(password), nowIso()]);
  return { username: u, password };
}

// تعديل بيانات الحساب. لا يُسمح للمدير بتغيير نوع حسابه هو (حتى لا يفقد صلاحية الإدارة).
export async function updateUser(id, input, selfId) {
  const { u, name, eid } = validate(input);
  const db = await getDb();
  const user = await db.get('SELECT id, role FROM users WHERE id = ?', [Number(id)]);
  if (!user) throw new UserError('المستخدم غير موجود.');
  if (user.id === Number(selfId) && input.role !== user.role) throw new UserError('لا يمكنك تغيير نوع حسابك أنت.');
  if (await db.get('SELECT 1 x FROM users WHERE username = ? AND id <> ?', [u, user.id])) throw new UserError('اسم المستخدم مستخدم من قبل.');
  if (input.role !== 'tpa') await keepOneAdmin(db, user.id);
  await db.run('UPDATE users SET username = ?, display_name = ?, role = ?, entity_id = ? WHERE id = ?', [u, name, input.role, eid, user.id]);
}

// تعيين كلمة مرور يحددها المدير (أو مؤقتة إن تُركت فارغة). يُخرج المستخدم من جلساته السابقة.
export async function setPassword(id, password) {
  const db = await getDb();
  const user = await db.get('SELECT username FROM users WHERE id = ?', [Number(id)]);
  if (!user) throw new UserError('المستخدم غير موجود.');
  const p = password ? checkNewPassword(password) : tempPassword();
  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(p), Number(id)]);
  return { username: user.username, password: p };
}

// لا يُوقف أو يُحذف آخر حساب إدارة TPA نشط (الحسابات الأخرى لا يشملها الشرط).
async function keepOneAdmin(db, exceptId) {
  const target = await db.get('SELECT role FROM users WHERE id = ?', [exceptId]);
  if (target?.role !== 'tpa') return;
  const n = (await db.get("SELECT COUNT(*) n FROM users WHERE role = 'tpa' AND active = 1 AND id <> ?", [exceptId])).n;
  if (!n) throw new UserError('يجب أن يبقى حساب إدارة TPA نشط واحد على الأقل.');
}

export async function setActive(id, active, selfId) {
  if (Number(id) === Number(selfId) && !active) throw new UserError('لا يمكنك إيقاف حسابك أنت.');
  const db = await getDb();
  if (!active) await keepOneAdmin(db, Number(id));
  await db.run('UPDATE users SET active = ? WHERE id = ?', [active ? 1 : 0, Number(id)]);
}

// حذف الحساب نهائيًا. سجل التغييرات يحفظ اسم المنفّذ نصًا، فلا يتأثر.
export async function deleteUser(id, selfId) {
  if (Number(id) === Number(selfId)) throw new UserError('لا يمكنك حذف حسابك أنت.');
  const db = await getDb();
  await keepOneAdmin(db, Number(id));
  const r = await db.run('DELETE FROM users WHERE id = ?', [Number(id)]);
  if (!r.changes) throw new UserError('المستخدم غير موجود.');
}
