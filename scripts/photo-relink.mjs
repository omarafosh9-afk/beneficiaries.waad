// يصحح صورًا رُبطت بالشخص الخطأ (رُفعت بطريقة «التسلسل العام» والصور مرقّمة برقم الملف داخل الدفعة).
// لكل صورة من رفع ZIP يُقرأ رقمها من اسم الملف الأصلي المحفوظ في سجل التغييرات («ملف مضغوط: 6.jpg»).
// كل رفعة (نفس الوقت) تُنسب إلى الدفعة التي تطابق أرقامها أكثر، ثم تُنقل كل صورة إلى صاحب رقمها في تلك الدفعة.
// من فقد صورة ولم تصله أخرى تعود له صورته السابقة إن وُجدت. لا تُحذف أي صورة من التخزين.
// الاستخدام: node scripts/photo-relink.mjs --entity=وعد [--apply]
import path from 'node:path';
import { openDb, tx, nowIso, DATA_DIR } from '../lib/db-node.js';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const apply = process.argv.includes('--apply');
const ACTOR = 'تصحيح ربط الصور برقم الملف';
const db = openDb();
const q = arg('entity');
if (!q) throw new Error('حدد الجهة: --entity=وعد (أو رقمها)');
const entity = db.prepare('SELECT id, name_ar FROM entities WHERE id = ? OR name_ar LIKE ?').get(Number(q) || -1, `%${q}%`);
if (!entity) throw new Error(`الجهة «${q}» غير موجودة`);

const rows = db.prepare('SELECT * FROM beneficiaries WHERE entity_id = ? AND deleted = 0').all(entity.id);
const byId = new Map(rows.map((r) => [r.id, r]));
// آخر رفع ZIP لكل سجل ما زالت صورته هي نفسها.
const evs = db.prepare(`SELECT e.* FROM beneficiary_events e JOIN beneficiaries b ON b.id = e.beneficiary_id
  WHERE b.entity_id = ? AND b.deleted = 0 AND e.action = 'photo' AND e.reason LIKE 'ملف مضغوط:%' ORDER BY e.id`).all(entity.id);
const last = new Map();
for (const e of evs) last.set(e.beneficiary_id, e);
const photos = [];
for (const [id, e] of last) {
  const b = byId.get(id);
  if (!b || b.photo_file !== e.new_value) continue; // تغيّرت صورته بعدها يدويًا: لا تُلمس
  const file = e.reason.replace(/^ملف مضغوط:\s*/, '');
  const m = /\d+/.exec(file.replace(/\.[^.]+$/, ''));
  photos.push({ holder: b, file, n: m ? Number(m[0]) : null, at: e.at, prev: e.old_value || null });
}

const moves = []; // { from, to, photo, file }
const report = { 'صور من رفع ZIP': photos.length, 'صحيحة': 0, 'تُنقل': 0, 'بلا رقم أو بلا صاحب': 0, 'تعارض': 0 };
const unsure = [];
const groups = new Map();
for (const p of photos) (groups.get(p.at) || groups.set(p.at, []).get(p.at)).push(p);
for (const [at, list] of groups) {
  // الدفعة التي تطابق أرقام هذه الرفعة أكثر.
  const batches = [...new Set(rows.map((r) => r.intake_batch).filter(Boolean))];
  const score = (b) => list.filter((p) => rows.some((r) => r.intake_batch === b && r.list_serial === p.n)).length;
  const batch = batches.sort((a, b) => score(b) - score(a))[0];
  for (const p of list) {
    const target = rows.find((r) => r.intake_batch === batch && r.list_serial === p.n);
    if (!target) { report['بلا رقم أو بلا صاحب']++; unsure.push(`${p.file} (رفعة ${at.slice(0, 16)}): لا أحد بالرقم ${p.n} في الدفعة ${batch}، والصورة عند ${p.holder.name}`); continue; }
    if (target.id === p.holder.id) { report['صحيحة']++; continue; }
    moves.push({ from: p.holder, to: target, photo: p.holder.photo_file, file: p.file, prev: p.prev, batch });
  }
}
// الهدف لديه صورة صحيحة أصلًا (لن تخرج منه) = تعارض، لا يُستبدل.
const leaving = new Set(moves.map((m) => m.from.id));
const correctHolders = new Set(photos.filter((p) => !leaving.has(p.holder.id)).map((p) => p.holder.id));
const ok = [];
for (const m of moves) {
  const keepsOwn = m.to.photo_file && !leaving.has(m.to.id) && (correctHolders.has(m.to.id) || !last.has(m.to.id));
  if (keepsOwn) { report['تعارض']++; unsure.push(`${m.file}: صاحبها ${m.to.name} لديه صورة أخرى؛ لم تُنقل (هي الآن عند ${m.from.name})`); continue; }
  ok.push(m);
}
report['تُنقل'] = ok.length;
const receivers = new Set(ok.map((m) => m.to.id));
const losers = ok.filter((m) => !receivers.has(m.from.id));

console.log(`الجهة: ${entity.name_ar}`, report);
console.log('\nتُنقل:');
for (const m of ok) console.log(`  ${m.file}: ${m.from.name} (عام ${m.from.seq} · د${m.from.intake_batch}·${m.from.list_serial}) ← ${m.to.name} (د${m.to.intake_batch}·${m.to.list_serial})`);
console.log('\nيفقد الصورة الخطأ:', losers.length ? '' : 'لا أحد');
for (const m of losers) console.log(`  ${m.from.name}: ${m.prev ? 'تعود صورته السابقة' : 'يصبح بلا صورة'}`);
if (unsure.length) console.log('\nللمراجعة اليدوية:\n  ' + unsure.join('\n  '));
if (!apply) {
  console.log('\nتجربة فقط؛ أضف --apply للتنفيذ.');
  process.exit(0);
}

const backup = path.join(DATA_DIR, `app.before-photo-relink-${Date.now()}.db`);
db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
console.log(`\nنسخة احتياطية: ${backup}`);
const at = nowIso();
const set = db.prepare('UPDATE beneficiaries SET photo_file = ?, version = version + 1, updated_at = ? WHERE id = ?');
const ev = db.prepare(`INSERT INTO beneficiary_events (beneficiary_id, action, field, old_value, new_value, reason, actor, at) VALUES (?, 'photo', 'photo_file', ?, ?, ?, ?, ?)`);
tx(db, () => {
  for (const m of losers) {
    set.run(m.prev, at, m.from.id);
    ev.run(m.from.id, m.photo, m.prev || '', `الصورة ${m.file} ليست له؛ نُقلت إلى ${m.to.name}`, ACTOR, at);
  }
  for (const m of ok) {
    set.run(m.photo, at, m.to.id);
    ev.run(m.to.id, m.to.photo_file || '', m.photo, `ملف مضغوط: ${m.file} (نُقلت من ${m.from.name})`, ACTOR, at);
  }
});
console.log(`تم: نُقلت ${ok.length} صورة.`);
