// يعيد ربط تسلسل جليانة (الدفعة + التسلسل في الدفعة + التسلسل العام) بأصحابه الصحيحين حسب الاسم في ملفات الدفعات.
// السبب: jalyana-replace طابق بـ«اسم قريب»، واسم الابن يحتوي اسم أبيه، فأخذ بعض الآباء أرقام أبنائهم ولم يُضف الأبناء.
// يحافظ على عمل المدققين: لا يغيّر اسمًا ولا مواليد ولا صلة ولا صورة ولا حالة مراجعة لأي سجل موجود؛ يغيّر أرقام التسلسل فقط،
// ويضيف من في الملف ولا يقابله أحد في المنظومة. النسخة المكررة لنفس الشخص (أضافها الاستيراد القديم) تُحذف حذفًا ناعمًا
// قابلًا للاسترجاع، وتبقى النسخة الأكثر عملًا (صورة، مراجعة). غير ذلك لا يُحذف أحد: من بقي بلا مقابل يفقد رقمه فقط.
// المطابقة بالترتيب: الاسم نفسه داخل العائلة، ثم اسم مقطوع/مكتوب بلا مسافة، ثم تشابه مع نفس الاسم الأول، ثم الاسم نفسه في الجهة إن كان فريدًا.
// الاستخدام: node scripts/jalyana-serial-fix.mjs "<الدفعة 1>" "<الدفعة 2>" [--apply]
import path from 'node:path';
import { createRequire } from 'node:module';
import { openDb, tx, nowIso, DATA_DIR } from '../lib/db-node.js';
import { normalizeAr, buildSearchKey, isPrincipal } from '../lib/derive.js';

const XLSX = createRequire(import.meta.url)('xlsx');
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const apply = process.argv.includes('--apply');
if (!files.length) throw new Error('حدد ملفات الدفعات');
const ENTITY = 2; // جليانة
const ACTOR = 'إعادة ربط تسلسل جليانة بالقوائم';
const REL = { 'الزوجة': 'زوجة', 'الابن': 'ابن', 'الابنة': 'ابنة', 'الموظف': 'موظف أساسي', 'الموظفة': 'موظف أساسي', 'موظف': 'موظف أساسي', 'زوجة': 'زوجة', 'زوج': 'زوج', 'ابن': 'ابن', 'ابنة': 'ابنة', 'اب': 'أب', 'أب': 'أب', 'ام': 'أم', 'أم': 'أم' };

const list = [];
files.forEach((file, i) => {
  const wb = XLSX.readFile(file);
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }).slice(1);
  let job = '';
  for (const r of raw) {
    if (String(r[1]).trim()) job = String(r[1]).trim();
    const name = String(r[2] || '').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const y = String(r[4] || '').trim();
    const rel = String(r[3] || '').trim();
    list.push({ seq: list.length + 1, batch: i + 1, serial: Number(r[0]) || null, job, name, relation: REL[rel] || rel,
      year: /^\d{4}$/.test(y) ? y : '', national: String(r[5] || '').trim() });
  }
});

const db = openDb();
const rows = db.prepare('SELECT * FROM beneficiaries WHERE entity_id = ? AND deleted = 0').all(ENTITY);
const compact = (s) => normalizeAr(s).replace(/\s+/g, '');
const first = (s) => normalizeAr(s).split(' ')[0];
const words = (s) => new Set(normalizeAr(s).split(' '));
const score = (a, b) => {
  const A = words(a), B = words(b);
  let s = 0;
  for (const w of A) if (B.has(w)) s++;
  return s / Math.max(A.size, B.size);
};
// العائلة: كل من له نفس الرقم المالي، ومن يشاركهم مفتاح العائلة.
const famKeysOfJob = new Map();
for (const r of rows) if (r.job_no) (famKeysOfJob.get(r.job_no) || famKeysOfJob.set(r.job_no, new Set()).get(r.job_no)).add(r.family_key);
const familyOf = (job) => {
  const keys = famKeysOfJob.get(job) || new Set();
  return rows.filter((r) => r.job_no === job || keys.has(r.family_key));
};

const used = new Map(); // id ← مدخل القائمة
const match = new Map(); // seq ← { b, how }
// عند تعدد النسخ بالاسم نفسه: الأكثر عملًا (صورة، ثم مراجعة، ثم مواليد)، ثم من يحمل رقم المدخل نفسه.
const work = (r) => (r.photo_file ? 4 : 0) + (r.review_status !== 'pending' ? 2 : 0) + (r.dob ? 1 : 0);
const holds = (r, p) => Number(r.intake_batch === p.batch && r.list_serial === p.serial);
const pick = (p, c) => [...c].sort((a, b) => work(b) - work(a) || holds(b, p) - holds(a, p))[0];
// اسم يطابق تمامًا شخصًا آخر في قائمة العائلة نفسها = ليس هذا الشخص (لا يُقبل كاسم مقطوع أو مشابه).
const listedElse = (p, r) => list.some((x) => x !== p && x.job === p.job && compact(x.name) === compact(r.name));
const passes = [
  // الاسم والتسلسل معًا، ما لم توجد نسخة أخرى بالاسم نفسه أكثر عملًا (صورة/مراجعة) فتُفضَّل هي في المرحلة التالية.
  ['الاسم والتسلسل', (p) => {
    const same = familyOf(p.job).filter((r) => !used.has(r.id) && compact(r.name) === compact(p.name));
    const best = Math.max(...same.map(work));
    return same.filter((r) => holds(r, p) && work(r) === best);
  }],
  ['الاسم نفسه', (p) => familyOf(p.job).filter((r) => compact(r.name) === compact(p.name))],
  ['اسم مقطوع', (p) => familyOf(p.job).filter((r) => !listedElse(p, r) && (compact(r.name).startsWith(compact(p.name)) || compact(p.name).startsWith(compact(r.name))))],
  // يحمل التسلسل نفسه وبالاسم الأول نفسه = الشخص نفسه وقد أكمل المدقق اسمه.
  ['التسلسل والاسم الأول', (p) => familyOf(p.job).filter((r) => holds(r, p) && !listedElse(p, r) && first(r.name) === first(p.name))],
  ['اسم مشابه', (p) => {
    const c = familyOf(p.job).filter((r) => !used.has(r.id) && !listedElse(p, r) && first(r.name) === first(p.name)).map((r) => [score(r.name, p.name), r]).filter(([s]) => s >= 0.6).sort((a, b) => b[0] - a[0]);
    return c.length && (c.length === 1 || c[1][0] < c[0][0]) ? [c[0][1]] : [];
  }],
  ['الاسم في الجهة', (p) => rows.filter((r) => compact(r.name) === compact(p.name))],
];
for (const [i, [how, find]] of passes.entries()) {
  for (const p of list) {
    if (match.has(p.seq)) continue;
    const c = find(p).filter((r) => !used.has(r.id));
    // تعدد بالاسم نفسه داخل العائلة = نسخ لنفس الشخص (إلا إن تكرر الاسم في القائمة نفسها)؛ في المراحل الأخرى يلزم مرشح واحد.
    const copies = i <= 1 && c.length > 1 && !list.some((x) => x !== p && x.job === p.job && compact(x.name) === compact(p.name));
    if (c.length === 1 || copies) {
      const b = c.length === 1 ? c[0] : pick(p, c);
      used.set(b.id, p);
      match.set(p.seq, { b, how });
    }
  }
}

const moves = []; // سجلات يتغير رقمها
for (const p of list) {
  const m = match.get(p.seq);
  if (!m) continue;
  const { b } = m;
  if (b.intake_batch !== p.batch || b.list_serial !== p.serial || b.seq !== p.seq) moves.push({ p, b, how: m.how });
}
const adds = list.filter((p) => !match.has(p.seq));
// نسخ مكررة: غير مطابقة، واسمها اسم شخص مطابق في عائلته.
const kept = [...used.keys()].map((id) => rows.find((r) => r.id === id));
const twinOf = (r) => kept.find((k) => k.family_key === r.family_key && compact(k.name) === compact(r.name));
const dups = rows.filter((r) => !used.has(r.id) && twinOf(r)).map((r) => ({ r, of: twinOf(r) }));
const dupIds = new Set(dups.map((d) => d.r.id));
const orphans = rows.filter((r) => !used.has(r.id) && !dupIds.has(r.id) && (r.list_serial != null || r.seq != null));

const by = (arr, f) => arr.reduce((o, x) => ((o[f(x)] = (o[f(x)] || 0) + 1), o), {});
console.log({ 'أسماء القوائم': list.length, 'مطابق': match.size, 'يتغير رقمه': moves.length, 'يُضاف (غير موجود)': adds.length,
  'نسخة مكررة تُحذف حذفًا ناعمًا': dups.length, 'يفقد رقمه (ليس في القوائم)': orphans.length });
console.log('طريقة المطابقة لمن يتغير رقمه:', by(moves, (x) => x.how));
const lbl = (r) => (r.intake_batch ? `${r.intake_batch}/${r.list_serial}` : '—');
console.log('\nيتغير رقمه:');
for (const { p, b, how } of moves) console.log(`  ${b.name}: ${lbl(b)} ← ${p.batch}/${p.serial}${compact(b.name) !== compact(p.name) ? ` (في الملف: ${p.name}، ${how})` : ''}`);
console.log('\nيُضاف:');
for (const p of adds) console.log(`  ${p.batch}/${p.serial} ${p.name} (${p.relation}، ${p.year || 'بلا مواليد'}) · الرقم المالي ${p.job}`);
console.log('\nنسخة مكررة تُحذف حذفًا ناعمًا (تبقى النسخة الأخرى برقمها الصحيح):');
const st = (r) => `${r.photo_file ? 'بصورة' : 'بلا صورة'}، ${r.review_status}`;
for (const { r, of } of dups) console.log(`  ${lbl(r)} ${r.name} (${st(r)}) ← تبقى نسخة ${of.id} (${st(of)})`);
console.log('\nيفقد رقمه ويبقى في المنظومة بلا تسلسل (للمراجعة):');
for (const r of orphans) console.log(`  ${lbl(r)} ${r.name} (${r.relation}) · الرقم المالي ${r.job_no || '—'} · ${r.review_status}`);
if (!apply) {
  console.log('\nتجربة فقط؛ أضف --apply للتنفيذ.');
  process.exit(0);
}

const backup = path.join(DATA_DIR, `app.before-serial-fix-${Date.now()}.db`);
db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
console.log(`\nنسخة احتياطية: ${backup}`);
const at = nowIso();
const ev = db.prepare('INSERT INTO beneficiary_events (beneficiary_id, action, field, old_value, new_value, reason, actor, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
tx(db, () => {
  // تصفير أرقام المتغيرين ومن يفقد رقمه أولًا حتى لا يتعارض الفهرس الفريد أثناء إعادة التوزيع.
  const clear = db.prepare('UPDATE beneficiaries SET list_serial = NULL, seq = NULL WHERE id = ?');
  for (const { b } of moves) clear.run(b.id);
  for (const r of orphans) clear.run(r.id);
  const del = db.prepare('UPDATE beneficiaries SET deleted = 1, list_serial = NULL, seq = NULL, version = version + 1, updated_at = ? WHERE id = ?');
  for (const { r, of } of dups) {
    del.run(at, r.id);
    ev.run(r.id, 'delete', 'deleted', '0', '1', `نسخة مكررة من السجل ${of.id} (${of.name})`, ACTOR, at);
  }
  const set = db.prepare('UPDATE beneficiaries SET intake_batch = ?, list_serial = ?, seq = ?, version = version + 1, updated_at = ? WHERE id = ?');
  for (const { p, b } of moves) {
    set.run(p.batch, p.serial, p.seq, at, b.id);
    ev.run(b.id, 'list_sync', 'list_serial', lbl(b), `${p.batch}/${p.serial}`, 'إعادة ربط التسلسل بالاسم في قائمة الدفعة', ACTOR, at);
  }
  for (const r of orphans) {
    db.prepare('UPDATE beneficiaries SET version = version + 1, updated_at = ? WHERE id = ?').run(at, r.id);
    ev.run(r.id, 'list_sync', 'list_serial', lbl(r), '', 'ليس في قوائم الدفعات بالاسم؛ أُزيل تسلسله', ACTOR, at);
  }
  // الإضافة في عائلة الرقم المالي (مفتاحها واسم موظفها إن وُجد).
  const ins = db.prepare(
    `INSERT INTO beneficiaries (entity_id, family_key, job_no, employee_name, name, relation, dob, national_id, intake_batch, list_serial, seq, legacy_status, search_key, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'نشط', ?, ?)`
  );
  for (const p of adds) {
    const fam = familyOf(p.job);
    const head = fam.find((r) => isPrincipal(r.relation)) || list.find((x) => x.job === p.job && isPrincipal(x.relation));
    const row = { family_key: fam[0]?.family_key || p.job, job_no: p.job, employee_name: head?.name || null, name: p.name,
      relation: p.relation, dob: p.year || null, national_id: p.national || null };
    const { lastInsertRowid } = ins.run(ENTITY, row.family_key, row.job_no, row.employee_name, row.name, row.relation, row.dob, row.national_id,
      p.batch, p.serial, p.seq, buildSearchKey(row), at);
    ev.run(Number(lastInsertRowid), 'add', null, null, null, `في الدفعة ${p.batch} بالتسلسل ${p.serial} ولم يكن في المنظومة`, ACTOR, at);
  }
});
console.log(`تم: ${moves.length} رقمًا أُعيد ربطه، ${adds.length} أُضيف، ${dups.length} نسخة مكررة حُذفت حذفًا ناعمًا، ${orphans.length} أُزيل رقمه.`);
