// يمسح أرقام البطاقات القديمة لجليانة فقط (card1/card2) من القاعدة؛ الرقم المالي وتجميع العائلات لا يتأثران.
// كل قيمة ممسوحة تُسجَّل في سجل التغييرات (قابلة للاسترجاع).
// الاستخدام: node scripts/jalyana-clear-cards.mjs [--apply]
import path from 'node:path';
import { openDb, tx, nowIso, DATA_DIR } from '../lib/db-node.js';
import { buildSearchKey } from '../lib/derive.js';

const ENTITY = 2; // جليانة
const ACTOR = 'مسح بطاقات جليانة القديمة';
const apply = process.argv.includes('--apply');

const db = openDb();
const rows = db.prepare("SELECT * FROM beneficiaries WHERE entity_id = ? AND (COALESCE(card1,'') <> '' OR COALESCE(card2,'') <> '')").all(ENTITY);
console.log(`مستفيدو جليانة الذين لديهم رقم بطاقة: ${rows.length}`);
if (!apply) {
  console.log('تجربة فقط؛ أضف --apply للتنفيذ.');
  process.exit(0);
}

const at = nowIso();
const backup = path.join(DATA_DIR, `app.before-clear-cards-${Date.now()}.db`);
db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
console.log(`نسخة احتياطية: ${backup}`);
const upd = db.prepare('UPDATE beneficiaries SET card1 = NULL, card2 = NULL, search_key = ? WHERE id = ?');
const ev = db.prepare('INSERT INTO beneficiary_events (beneficiary_id, action, field, old_value, new_value, reason, actor, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
tx(db, () => {
  for (const r of rows) {
    upd.run(buildSearchKey({ ...r, card1: null, card2: null }), r.id);
    if (r.card1) ev.run(r.id, 'edit', 'card1', r.card1, null, 'مسح رقم البطاقة القديم', ACTOR, at);
    if (r.card2) ev.run(r.id, 'edit', 'card2', r.card2, null, 'مسح رقم البطاقة القديم', ACTOR, at);
  }
});
console.log(`تم مسح أرقام البطاقات لـ ${rows.length} مستفيدًا.`);
