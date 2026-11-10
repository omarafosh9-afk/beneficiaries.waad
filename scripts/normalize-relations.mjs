// يوحّد كتابة صلة القرابة في كل الجهات (ابنه/أبنة/إبنة → ابنة، زوجه → زوجة، ...) مع تسجيل كل تغيير.
// الاستخدام: node scripts/normalize-relations.mjs [--apply]
import { openDb, tx, nowIso } from '../lib/db-node.js';
import { RELATIONS } from '../lib/beneficiaries.js';
import { relationOf } from '../lib/beneficiary-import.js';

const apply = process.argv.includes('--apply');
const db = openDb();
const rows = db.prepare('SELECT id, relation FROM beneficiaries WHERE deleted = 0').all();
const fixes = rows.filter((r) => !RELATIONS.includes(r.relation)).map((r) => ({ ...r, to: relationOf(r.relation) }));
const counts = {};
for (const f of fixes) counts[`${f.relation || 'فارغ'} → ${f.to || 'غير معروف'}`] = (counts[`${f.relation || 'فارغ'} → ${f.to || 'غير معروف'}`] || 0) + 1;
console.log(counts);
const ok = fixes.filter((f) => f.to);
if (!apply) {
  console.log(`سيُوحَّد: ${ok.length}. تجربة فقط؛ أضف --apply للتنفيذ.`);
  process.exit(0);
}
const at = nowIso();
const upd = db.prepare('UPDATE beneficiaries SET relation = ?, version = version + 1, updated_at = ? WHERE id = ?');
const ev = db.prepare("INSERT INTO beneficiary_events (beneficiary_id, action, field, old_value, new_value, reason, actor, at) VALUES (?, 'list_sync', 'relation', ?, ?, 'توحيد كتابة صلة القرابة', 'النظام', ?)");
tx(db, () => {
  for (const f of ok) {
    upd.run(f.to, at, f.id);
    ev.run(f.id, f.relation, f.to, at);
  }
});
console.log(`تم توحيد ${ok.length}.`);
