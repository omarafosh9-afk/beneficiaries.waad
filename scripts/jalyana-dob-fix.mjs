// يصحح مواليد جليانة من ملفات الدفعات: البيانات القديمة نسخت مواليد الموظف (غالبًا yyyy-01-01) على أفراد العائلة،
// وjalyana-replace أبقى القيمة القديمة لأنها لم تكن فارغة. المرجع هنا سنة الميلاد في القائمة.
// المطابقة: الدفعة + التسلسل في الدفعة، مع تطابق الاسم. لا يلمس مواليد عدّلها مستخدم من الشاشة.
// الاستخدام: node scripts/jalyana-dob-fix.mjs "<الدفعة 1>" "<الدفعة 2>" ... [--apply]
import path from 'node:path';
import { createRequire } from 'node:module';
import { openDb, tx, nowIso, DATA_DIR } from '../lib/db-node.js';
import { normalizeAr } from '../lib/derive.js';

const XLSX = createRequire(import.meta.url)('xlsx');
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const apply = process.argv.includes('--apply');
if (!files.length) throw new Error('حدد ملفات الدفعات');
const ENTITY = 2; // جليانة
const ACTOR = 'تصحيح مواليد جليانة من القوائم';

const db = openDb();
const rows = db.prepare('SELECT * FROM beneficiaries WHERE entity_id = ? AND deleted = 0 AND list_serial IS NOT NULL').all(ENTITY);
const byKey = new Map(rows.map((r) => [`${r.intake_batch}|${r.list_serial}`, r]));
const userEdited = new Set(
  db.prepare("SELECT DISTINCT beneficiary_id id FROM beneficiary_events WHERE action = 'edit' AND field = 'dob'").all().map((r) => r.id)
);

const fixes = [];
const stats = { inList: 0, same: 0, noYear: 0, notFound: 0, nameMismatch: 0, userEdited: 0 };
files.forEach((file, i) => {
  const wb = XLSX.readFile(file);
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }).slice(1);
  for (const r of raw) {
    const name = String(r[2] || '').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    stats.inList++;
    const year = String(r[4] || '').trim();
    if (!/^\d{4}$/.test(year)) { stats.noYear++; continue; }
    const b = byKey.get(`${i + 1}|${Number(r[0])}`);
    if (!b) { stats.notFound++; continue; }
    // الاسم في القائمة أو المنظومة قد يكون مقطوعًا؛ غير ذلك = شخص آخر في نفس التسلسل (لا يُلمس).
    const [x, y] = [normalizeAr(b.name), normalizeAr(name)];
    if (!x.startsWith(y) && !y.startsWith(x)) {
      stats.nameMismatch++;
      if (process.env.SHOW) console.log('  ≠', b.name, '|', name, '|', b.dob, year);
      continue;
    }
    if (String(b.dob || '').match(/\d{4}/)?.[0] === year) { stats.same++; continue; }
    if (userEdited.has(b.id)) { stats.userEdited++; continue; }
    fixes.push({ b, year });
  }
});
console.log(stats);
console.log(`سيُصحَّح: ${fixes.length}`);
for (const { b, year } of fixes.slice(0, 10)) console.log(`  ${b.name} (${b.relation}): ${b.dob || 'فارغ'} ← ${year}`);
if (!apply) {
  console.log('تجربة فقط؛ أضف --apply للتنفيذ.');
  process.exit(0);
}

const backup = path.join(DATA_DIR, `app.before-dob-fix-${Date.now()}.db`);
db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
console.log(`نسخة احتياطية: ${backup}`);
const at = nowIso();
const upd = db.prepare('UPDATE beneficiaries SET dob = ?, version = version + 1, updated_at = ? WHERE id = ?');
const ev = db.prepare('INSERT INTO beneficiary_events (beneficiary_id, action, field, old_value, new_value, reason, actor, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
tx(db, () => {
  for (const { b, year } of fixes) {
    upd.run(year, at, b.id);
    ev.run(b.id, 'list_sync', 'dob', b.dob || '', year, 'سنة الميلاد من قائمة الدفعة', ACTOR, at);
  }
});
console.log(`تم تصحيح ${fixes.length} تاريخ ميلاد.`);
