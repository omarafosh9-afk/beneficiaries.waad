// يجعل مستفيدي جليانة في المنظومة = القائمة المعطاة فقط (مثل «الدفعة الاولى.xlsx»):
//  - من يطابق القائمة يبقى (برقم بطاقته وصورته) ويُحدَّث رقمه الوطني ومواليده إن نقصت.
//  - من في القائمة وليس في المنظومة يُضاف (بلا رقم بطاقة؛ يُعلَّم للمراجعة).
//  - كل مستفيد جليانة آخر يُحذف حذفًا ناعمًا (قابل للاستعادة من سجل التغييرات).
// المطابقة: الرقم المالي (من رقم البطاقة) + الاسم، ثم اسم قريب داخل العائلة، ثم الاسم وحده إن كان فريدًا.
// الاستخدام: node scripts/jalyana-replace.mjs "<ملف القائمة>" [--apply]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { openDb, tx, nowIso, DATA_DIR } from '../lib/db-node.js';
import { normalizeAr, buildSearchKey, familyKeyFromCard, isPrincipal } from '../lib/derive.js';

const XLSX = createRequire(import.meta.url)('xlsx');
const file = process.argv[2];
const apply = process.argv.includes('--apply');
if (!file) throw new Error('حدد ملف القائمة');
const ENTITY = 2; // جليانة
const ACTOR = 'قائمة جليانة 2027';
const REL = { 'الموظف': 'موظف أساسي', 'موظف': 'موظف أساسي', 'زوجة': 'زوجة', 'زوج': 'زوج', 'ابن': 'ابن', 'ابنة': 'ابنة', 'اب': 'أب', 'أب': 'أب', 'ام': 'أم', 'أم': 'أم' };

// قراءة القائمة: الرقم المالي مكتوب في أول صف من العائلة فقط.
const wb = XLSX.readFile(file);
const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }).slice(1);
let job = '';
const list = [];
for (const r of raw) {
  if (String(r[1]).trim()) job = String(r[1]).trim();
  const name = String(r[2] || '').replace(/\s+/g, ' ').trim();
  if (!name) continue;
  const rel = String(r[3] || '').trim();
  const y = String(r[4] || '').trim();
  list.push({ serial: Number(r[0]) || null, job, name, relation: REL[rel] || rel, year: /^\d{4}$/.test(y) ? y : '', national: String(r[5] || '').trim() });
}

const db = openDb();
const rows = db.prepare('SELECT * FROM beneficiaries WHERE entity_id = ? AND deleted = 0').all(ENTITY);
const byJob = new Map();
for (const r of rows) {
  const j = familyKeyFromCard(r.card1 || r.card2);
  if (!j) continue;
  if (!byJob.has(j)) byJob.set(j, []);
  byJob.get(j).push(r);
}
const byName = new Map();
for (const r of rows) {
  const k = normalizeAr(r.name);
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push(r);
}
const words = (n) => new Set(normalizeAr(n).split(' '));
const score = (a, b) => {
  const A = words(a), B = words(b);
  let s = 0;
  for (const w of A) if (B.has(w)) s++;
  return s / Math.max(A.size, B.size);
};

const used = new Set();
const keep = [];
const add = [];
for (const p of list) {
  const fam = (byJob.get(p.job) || []).filter((r) => !used.has(r.id));
  let hit = fam.find((r) => normalizeAr(r.name) === normalizeAr(p.name));
  let how = 'الرقم المالي + الاسم';
  if (!hit && fam.length) {
    const c = fam.map((r) => [score(p.name, r.name), r]).sort((a, b) => b[0] - a[0]);
    if (c[0][0] >= 0.75 && (c.length === 1 || c[1][0] < c[0][0])) { hit = c[0][1]; how = 'الرقم المالي + اسم قريب'; }
  }
  if (!hit) {
    const c = (byName.get(normalizeAr(p.name)) || []).filter((r) => !used.has(r.id));
    if (c.length === 1) { hit = c[0]; how = 'الاسم فقط'; }
  }
  if (hit) { used.add(hit.id); keep.push({ p, b: hit, how }); }
  else add.push(p);
}
const remove = rows.filter((r) => !used.has(r.id));

const by = (arr, f) => arr.reduce((o, x) => ((o[f(x)] = (o[f(x)] || 0) + 1), o), {});
console.table({
  'أسماء القائمة': list.length,
  'مستفيدو جليانة الحاليون': rows.length,
  'يبقون (مطابقون للقائمة)': keep.length,
  '  منهم بصورة': keep.filter((x) => x.b.photo_file).length,
  'يُضافون (في القائمة فقط، بلا رقم بطاقة)': add.length,
  'يُحذفون حذفًا ناعمًا (ليسوا في القائمة)': remove.length,
});
console.log('طريقة المطابقة:', by(keep, (x) => x.how));

if (!apply) {
  console.log('تقرير فقط. للتنفيذ أضف --apply');
  process.exit(0);
}

const backupDir = path.join(DATA_DIR, 'backups');
fs.mkdirSync(backupDir, { recursive: true });
const backup = path.join(backupDir, `before-jalyana-2027-${Date.now()}.db`);
db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
console.log('نسخة احتياطية: ' + backup);

const at = nowIso();
const ev = db.prepare('INSERT INTO beneficiary_events (beneficiary_id, action, field, old_value, new_value, reason, actor, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
tx(db, () => {
  const del = db.prepare('UPDATE beneficiaries SET deleted = 1, version = version + 1, updated_at = ? WHERE id = ?');
  for (const r of remove) { del.run(at, r.id); ev.run(r.id, 'delete', 'deleted', '0', '1', 'ليس في قائمة جليانة 2027', ACTOR, at); }

  // الرقم التسلسلي يُصفَّر أولًا ثم يُعاد ضبطه، حتى لا يتعارض مع الفهرس الفريد أثناء التحديث.
  db.prepare('UPDATE beneficiaries SET list_serial = NULL WHERE entity_id = ? AND intake_batch = 1').run(ENTITY);
  const upd = db.prepare('UPDATE beneficiaries SET national_id = ?, dob = ?, intake_batch = 1, list_serial = ?, search_key = ?, version = version + 1, updated_at = ? WHERE id = ?');
  for (const { p, b } of keep) {
    const national = p.national || b.national_id;
    const dob = b.dob || p.year || null;
    if (national !== b.national_id) ev.run(b.id, 'list_sync', 'national_id', b.national_id || '', national, 'قائمة جليانة 2027', ACTOR, at);
    if (dob !== b.dob) ev.run(b.id, 'list_sync', 'dob', b.dob || '', dob, 'قائمة جليانة 2027', ACTOR, at);
    upd.run(national, dob, p.serial, buildSearchKey({ ...b, national_id: national }), at, b.id);
  }

  let nextId = db.prepare('SELECT MAX(id) m FROM beneficiaries').get().m;
  const ins = db.prepare(
    `INSERT INTO beneficiaries (id, entity_id, family_key, job_no, employee_name, name, relation, dob, national_id, intake_batch, list_serial, legacy_status, search_key, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'نشط', ?, ?)`
  );
  for (const p of add) {
    const fam = p.job || `name:${normalizeAr(p.name)}`;
    const head = list.find((x) => x.job === p.job && isPrincipal(x.relation));
    const row = { id: ++nextId, family_key: fam, job_no: p.job || null, employee_name: isPrincipal(p.relation) ? p.name : head?.name || null,
      name: p.name, relation: p.relation, dob: p.year || null, national_id: p.national || null };
    ins.run(row.id, ENTITY, row.family_key, row.job_no, row.employee_name, row.name, row.relation, row.dob, row.national_id, p.serial, buildSearchKey(row), at);
    ev.run(row.id, 'add', null, null, null, 'من قائمة جليانة 2027 (بلا رقم بطاقة)', ACTOR, at);
  }
});
console.log(`تم: بقي ${keep.length}، أضيف ${add.length}، حُذف ${remove.length} (حذف ناعم).`);
