// إضافة مستخدم أو تحديث كلمة مروره.
// npm run user:add -- --username tpa --name "إدارة TPA" --role tpa --password "..."
// npm run user:add -- --username jalyana --name "مراجع جليانة" --role entity --entity Jalyana --password "..."
import { openDb, nowIso } from '../lib/db.js';
import { hashPassword } from '../lib/session.js';
import { ENTITY_IDS } from '../lib/derive.js';

const args = process.argv.slice(2);
const get = (k) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const username = get('username');
const name = get('name') || username;
const role = get('role');
const entity = get('entity');
const password = get('password');

if (!username || !password || !['tpa', 'entity', 'printer'].includes(role)) {
  console.error('الاستخدام: --username U --password P --role tpa|entity|printer [--entity Cement|Jalyana|Jamarek] [--name "الاسم"]');
  process.exit(1);
}
if (password.length < 8) {
  console.error('كلمة المرور 8 أحرف على الأقل.');
  process.exit(1);
}
const entityId = role === 'entity' ? ENTITY_IDS[entity] : null;
if (role === 'entity' && !entityId) {
  console.error('حدد الجهة: --entity Cement|Jalyana|Jamarek');
  process.exit(1);
}

const db = openDb();
db.prepare(
  `INSERT INTO users (username, display_name, role, entity_id, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)
   ON CONFLICT(username) DO UPDATE SET display_name = excluded.display_name, role = excluded.role,
   entity_id = excluded.entity_id, password_hash = excluded.password_hash, active = 1`
).run(username, name, role, entityId, hashPassword(password), nowIso());
console.log(`تم حفظ المستخدم ${username} (${role}${entity ? ' / ' + entity : ''}).`);
db.close();
