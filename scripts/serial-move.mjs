// ينقل رقم تسلسل (الدفعة/التسلسل) في جهة إلى مستفيد آخر بالاسم الكامل، ويحفظ عمل المدققين:
// صاحب الرقم الحالي يُحذف حذفًا ناعمًا إن كان سجلًا أضافه سكربت إعادة الربط ولم يُراجَع، وإلا يفقد رقمه فقط.
// الاستخدام: node scripts/serial-move.mjs --batch=1 --serial=134 --to="الاسم الكامل" [--entity=2] [--apply]
import path from 'node:path';
import { openDb, tx, nowIso, DATA_DIR } from '../lib/db-node.js';
import { normalizeAr } from '../lib/derive.js';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const apply = process.argv.includes('--apply');
const ENTITY = Number(arg('entity') || 2);
const batch = Number(arg('batch'));
const serial = Number(arg('serial'));
const to = arg('to');
if (!batch || !serial || !to) throw new Error('الاستخدام: --batch=1 --serial=134 --to="الاسم الكامل"');
const ACTOR = 'نقل رقم التسلسل';
const ADDER = 'إعادة ربط تسلسل جليانة بالقوائم';

const db = openDb();
const holder = db.prepare('SELECT * FROM beneficiaries WHERE entity_id = ? AND deleted = 0 AND intake_batch = ? AND list_serial = ?').get(ENTITY, batch, serial);
const targets = db.prepare('SELECT * FROM beneficiaries WHERE entity_id = ? AND deleted = 0').all(ENTITY)
  .filter((r) => normalizeAr(r.name).replace(/\s+/g, '') === normalizeAr(to).replace(/\s+/g, ''));
if (targets.length !== 1) throw new Error(`«${to}»: ${targets.length ? `${targets.length} سجلات بهذا الاسم؛ لا يمكن التحديد` : 'غير موجود'}.`);
const target = targets[0];
if (holder?.id === target.id) { console.log('الرقم عنده أصلًا.'); process.exit(0); }
// أضافه سكربت إعادة الربط ولم يلمسه أحد بعدها = نسخة مكررة لصاحب الرقم الجديد.
const addedByFix = holder && holder.review_status === 'pending' && !holder.photo_file
  && db.prepare("SELECT 1 FROM beneficiary_events WHERE beneficiary_id = ? AND action = 'add' AND actor = ?").get(holder.id, ADDER)
  && !db.prepare("SELECT 1 FROM beneficiary_events WHERE beneficiary_id = ? AND actor <> ?").get(holder.id, ADDER);
const seq = holder?.seq ?? null;

console.log(`الرقم ${batch}/${serial} ← ${target.name} (${target.relation}، ${target.review_status}${target.photo_file ? '، بصورة' : ''})`);
if (holder) console.log(`صاحبه الحالي: ${holder.name} (${holder.relation}) → ${addedByFix ? 'حذف ناعم (نسخة أضافها سكربت إعادة الربط)' : 'يفقد رقمه فقط'}`);
if (target.list_serial != null) console.log(`ملاحظة: ${target.name} يترك رقمه الحالي ${target.intake_batch}/${target.list_serial}`);
if (!apply) {
  console.log('تجربة فقط؛ أضف --apply للتنفيذ.');
  process.exit(0);
}

const backup = path.join(DATA_DIR, `app.before-serial-move-${Date.now()}.db`);
db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
console.log(`نسخة احتياطية: ${backup}`);
const at = nowIso();
const ev = db.prepare('INSERT INTO beneficiary_events (beneficiary_id, action, field, old_value, new_value, reason, actor, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
tx(db, () => {
  if (holder) {
    db.prepare(`UPDATE beneficiaries SET list_serial = NULL, seq = NULL, ${addedByFix ? 'deleted = 1, ' : ''}version = version + 1, updated_at = ? WHERE id = ?`).run(at, holder.id);
    ev.run(holder.id, addedByFix ? 'delete' : 'list_sync', addedByFix ? 'deleted' : 'list_serial', addedByFix ? '0' : `${batch}/${serial}`, addedByFix ? '1' : '',
      `الرقم ${batch}/${serial} نُقل إلى ${target.name}`, ACTOR, at);
  }
  const old = target.list_serial != null ? `${target.intake_batch}/${target.list_serial}` : '';
  db.prepare('UPDATE beneficiaries SET intake_batch = ?, list_serial = ?, seq = COALESCE(?, seq), version = version + 1, updated_at = ? WHERE id = ?')
    .run(batch, serial, seq, at, target.id);
  ev.run(target.id, 'list_sync', 'list_serial', old, `${batch}/${serial}`, 'نقل رقم التسلسل إليه', ACTOR, at);
});
console.log('تم.');
