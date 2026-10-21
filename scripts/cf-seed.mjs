// يجهّز بيانات تجربة لـ Cloudflare من القاعدة المحلية: عائلات من جهة واحدة حتى يكتمل
// عدد الصور المطلوب (افتراضيا 10)، مع مستخدمَين (TPA وحساب الجهة) بكلمات مرور مؤقتة.
// المخرجات في .wrangler/seed/: seed.sql (المخطط + البيانات) و photos/ (الصور) و photos.json.
// الاستخدام: node scripts/cf-seed.mjs [--entity Jalyana] [--photos 10]
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../lib/db-node.js';
import { SCHEMA_V1 } from '../lib/schema.js';
import { STORAGE_DIR } from '../lib/photos.js';
import { ENTITY_IDS } from '../lib/derive.js';
import { hashPassword } from '../lib/session.js';
import { tempPassword } from '../lib/users.js';

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const code = arg('entity', 'Jalyana');
const wantPhotos = Number(arg('photos', 10));
const entityId = ENTITY_IDS[code];

const db = openDb();
// عائلات فيها صور، بالترتيب، حتى نصل للعدد المطلوب من الصور.
const families = db.prepare(
  `SELECT family_key, SUM(photo_file IS NOT NULL) photos, COUNT(*) n FROM beneficiaries
   WHERE entity_id = ? AND deleted = 0 GROUP BY family_key HAVING photos >= 2 AND n <= 6 ORDER BY CAST(family_key AS INTEGER)`
).all(entityId);
const rows = [];
let photos = 0;
for (const f of families) {
  if (photos >= wantPhotos) break;
  const members = db.prepare('SELECT * FROM beneficiaries WHERE entity_id = ? AND family_key = ? AND deleted = 0 ORDER BY id').all(entityId, f.family_key);
  for (const m of members) {
    if (m.photo_file && photos >= wantPhotos) m.photo_file = null;
    if (m.photo_file && !fs.existsSync(path.join(STORAGE_DIR, code, m.photo_file))) m.photo_file = null;
    if (m.photo_file) photos++;
    rows.push(m);
  }
}

const originals = new Map(rows.map((r) => [r.id, r.photo_file]));
for (const r of rows) if (r.photo_file) r.photo_file = `${r.id}.webp`;
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const cols = ['id', 'entity_id', 'family_key', 'job_no', 'employee_name', 'name', 'relation', 'dob', 'national_id', 'card1', 'card2',
  'photo_file', 'review_status', 'intake_batch', 'legacy_status', 'deleted', 'search_key', 'version', 'updated_at'];
const now = new Date().toISOString();
const users = [
  { username: 'tpa', name: 'إدارة TPA', role: 'tpa', entity: null, password: tempPassword() },
  { username: code.toLowerCase(), name: `مراجع ${code === 'Jalyana' ? 'جليانة' : code}`, role: 'entity', entity: entityId, password: tempPassword() },
];

const sql = [
  'PRAGMA foreign_keys = OFF;',
  'DROP TABLE IF EXISTS beneficiary_events;', 'DROP TABLE IF EXISTS users;', 'DROP TABLE IF EXISTS beneficiaries;',
  'DROP TABLE IF EXISTS print_batches;', 'DROP TABLE IF EXISTS entities;',
  SCHEMA_V1.trim(),
  ...rows.map((r) => `INSERT INTO beneficiaries (${cols.join(', ')}) VALUES (${cols.map((c) => q(c === 'review_status' ? 'pending' : c === 'version' ? 1 : c === 'updated_at' ? now : r[c])).join(', ')});`),
  ...users.map((u) => `INSERT INTO users (username, display_name, role, entity_id, password_hash, created_at) VALUES (${q(u.username)}, ${q(u.name)}, ${q(u.role)}, ${q(u.entity)}, ${q(hashPassword(u.password))}, ${q(now)});`),
].join('\n');

const out = path.join(process.cwd(), '.wrangler', 'seed');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'seed.sql'), sql + '\n');
// مفاتيح KV بأسماء بسيطة <id>.webp، وملف رفع جماعي واحد (kv bulk put) بقيم base64.
const list = rows.filter((r) => r.photo_file).map((r) => ({
  key: `${code}/${r.id}.webp`,
  value: fs.readFileSync(path.join(STORAGE_DIR, code, originals.get(r.id))).toString('base64'),
  base64: true,
}));
fs.writeFileSync(path.join(out, 'photos.json'), JSON.stringify(list));
console.log(`المستفيدون: ${rows.length} (بصور: ${list.length}) من ${new Set(rows.map((r) => r.family_key)).size} عائلات — ${code}`);
for (const u of users) console.log(`مستخدم: ${u.username}  كلمة المرور: ${u.password}`);
