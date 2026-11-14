// يصحح الرقم الوظيفي (المالي) لجليانة من ملفات الدفعات: jalyana-replace أبقى الرقم القديم لمن طابقهم.
// إن كان الرقم الصحيح لعائلة موجودة، فهي العائلة نفسها مقسومة في البيانات القديمة: يُضمّ أفرادها إليها.
// المطابقة: الدفعة + التسلسل في الدفعة مع تطابق الاسم (يُقبل الاسم المقطوع). لا يلمس رقمًا عدّله مستخدم.
// الاستخدام: node scripts/jalyana-job-fix.mjs "<الدفعة 1>" "<الدفعة 2>" ... [--apply]
import path from 'node:path';
import { createRequire } from 'node:module';
import { openDb, tx, nowIso, DATA_DIR } from '../lib/db-node.js';
import { normalizeAr, buildSearchKey } from '../lib/derive.js';

const XLSX = createRequire(import.meta.url)('xlsx');
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const apply = process.argv.includes('--apply');
if (!files.length) throw new Error('حدد ملفات الدفعات');
const ENTITY = 2; // جليانة
const ACTOR = 'تصحيح الرقم الوظيفي لجليانة من القوائم';

const db = openDb();
const rows = db.prepare('SELECT * FROM beneficiaries WHERE entity_id = ? AND deleted = 0').all(ENTITY);
const byKey = new Map(rows.filter((r) => r.list_serial != null).map((r) => [`${r.intake_batch}|${r.list_serial}`, r]));
const userEdited = new Set(
  db.prepare("SELECT DISTINCT beneficiary_id id FROM beneficiary_events WHERE action = 'edit' AND field = 'job_no'").all().map((r) => r.id)
);

const fixes = [];
const stats = { inList: 0, same: 0, notFound: 0, nameMismatch: 0, userEdited: 0 };
files.forEach((file, i) => {
  const wb = XLSX.readFile(file);
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }).slice(1);
  let job = '';
  for (const r of raw) {
    if (String(r[1]).trim()) job = String(r[1]).trim();
    const name = String(r[2] || '').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    stats.inList++;
    const b = byKey.get(`${i + 1}|${Number(r[0])}`);
    if (!b) { stats.notFound++; continue; }
    const [x, y] = [normalizeAr(b.name), normalizeAr(name)];
    if (!x.startsWith(y) && !y.startsWith(x)) { stats.nameMismatch++; continue; }
    if (String(b.job_no || '') === job) { stats.same++; continue; }
    if (userEdited.has(b.id)) { stats.userEdited++; continue; }
    fixes.push({ b, job });
  }
});

// الرقم الصحيح المستخدم لعائلة أخرى = نفس العائلة مقسومة: يُضمّ المصحَّح إليها (مفتاحها واسم موظفها).
const fixedIds = new Set(fixes.map((f) => f.b.id));
for (const f of fixes) {
  const home = rows.find((r) => r.job_no === f.job && !fixedIds.has(r.id));
  f.family = home ? home.family_key : f.b.family_key;
  const members = rows.filter((r) => r.family_key === f.family && (!fixedIds.has(r.id) || fixes.some((x) => x.b.id === r.id && x.job === f.job)));
  const head = members.find((r) => r.relation === 'موظف أساسي');
  f.employee = head ? head.name : f.b.employee_name;
  f.merge = home ? home.name : null;
}
console.log(stats);
console.log(`سيُصحَّح: ${fixes.length} في ${new Set(fixes.map((f) => f.job)).size} عائلة`);
for (const f of fixes) console.log(`  ${f.b.name}: ${f.b.job_no || 'فارغ'} ← ${f.job}${f.merge ? ` (يُضم لعائلة ${f.merge})` : ''}`);
if (!apply) {
  console.log('تجربة فقط؛ أضف --apply للتنفيذ.');
  process.exit(0);
}

const backup = path.join(DATA_DIR, `app.before-job-fix-${Date.now()}.db`);
db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
console.log(`نسخة احتياطية: ${backup}`);
const at = nowIso();
const upd = db.prepare('UPDATE beneficiaries SET job_no = ?, family_key = ?, employee_name = ?, search_key = ?, version = version + 1, updated_at = ? WHERE id = ?');
const ev = db.prepare('INSERT INTO beneficiary_events (beneficiary_id, action, field, old_value, new_value, reason, actor, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
tx(db, () => {
  for (const { b, job, family, employee } of fixes) {
    upd.run(job, family, employee, buildSearchKey({ ...b, job_no: job, employee_name: employee }), at, b.id);
    ev.run(b.id, 'list_sync', 'job_no', b.job_no || '', job, 'الرقم المالي من قائمة الدفعة', ACTOR, at);
    if (family !== b.family_key) ev.run(b.id, 'list_sync', 'family_key', b.family_key, family, 'ضمّ لعائلته حسب قائمة الدفعة', ACTOR, at);
  }
});
console.log(`تم تصحيح ${fixes.length} رقمًا وظيفيًا.`);
