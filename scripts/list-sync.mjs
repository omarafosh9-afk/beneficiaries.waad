// يجعل أرقام جهة مطابقة لقائمتها (ملف بالقالب: التسلسل، الاسم، صلة القرابة، تاريخ الميلاد، ...) في دفعة واحدة:
// كل من في الملف ← الدفعة المحددة برقمه في الملف، والتسلسل العام = رقمه في الملف؛ ومن في الملف وليس في المنظومة يُضاف.
// يحافظ على عمل المدققين: لا يغيّر اسمًا ولا صلة ولا صورة ولا حالة مراجعة لأي سجل موجود (يملأ المواليد الفارغة فقط).
// من في المنظومة وليس في الملف لا يُحذف: يفقد رقمه فقط ويُذكر للمراجعة.
// --regroup: يعيد بناء العائلات من ترتيب الملف لمن هم في المنظومة أيضًا (الموظف يبدأ عائلة، ومن تحته يتبعونه حتى الموظف التالي).
// الاستخدام: node scripts/list-sync.mjs --entity=وعد "<الملف.xlsx>" [--batch=1] [--regroup] [--apply]
import path from 'node:path';
import { createRequire } from 'node:module';
import { openDb, tx, nowIso, DATA_DIR } from '../lib/db-node.js';
import { normalizeAr, buildSearchKey, isPrincipal, parseDob } from '../lib/derive.js';
import { relationOf, dobCell } from '../lib/beneficiary-import.js';

const XLSX = createRequire(import.meta.url)('xlsx');
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
const apply = process.argv.includes('--apply');
const REGROUP = process.argv.includes('--regroup');
const BATCH = Number(arg('batch') || 1);
const ACTOR = 'مطابقة أرقام الجهة لقائمتها';
if (!file || !arg('entity')) throw new Error('الاستخدام: --entity=وعد "<الملف.xlsx>" [--batch=1] [--apply]');

const db = openDb();
const q = arg('entity');
const entity = db.prepare('SELECT id, name_ar FROM entities WHERE id = ? OR name_ar LIKE ?').get(Number(q) || -1, `%${q}%`);
if (!entity) throw new Error(`الجهة «${q}» غير موجودة`);

const wb = XLSX.readFile(file, { cellDates: true });
const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
const head = raw[0].map((h) => normalizeAr(h));
const col = (n) => head.indexOf(normalizeAr(n));
const [cS, cN, cR, cD, cJ, cNat] = ['التسلسل', 'الاسم', 'صلة القرابة', 'تاريخ الميلاد', 'الرقم الوظيفي', 'الرقم الوطني'].map(col);
if (cS < 0 || cN < 0) throw new Error('الملف يحتاج عمودي «التسلسل» و«الاسم».');
const list = [];
for (const r of raw.slice(1)) {
  const name = String(r[cN] ?? '').replace(/\s+/g, ' ').trim();
  const serial = Number(r[cS]);
  if (!name || !Number.isInteger(serial) || serial <= 0) continue;
  const dob = cD >= 0 ? parseDob(dobCell(r[cD])) : '';
  list.push({ serial, name, relation: cR >= 0 ? relationOf(r[cR]) || '' : '', dob: dob || '', job: cJ >= 0 ? String(r[cJ] ?? '').trim() : '',
    national: cNat >= 0 ? String(r[cNat] ?? '').trim() : '' });
}
const dupSerial = list.filter((p, i) => list.findIndex((x) => x.serial === p.serial) !== i);
if (dupSerial.length) throw new Error(`أرقام مكررة في الملف: ${dupSerial.map((p) => p.serial).join('، ')}`);

const rows = db.prepare('SELECT * FROM beneficiaries WHERE entity_id = ? AND deleted = 0').all(entity.id);
const compact = (s) => normalizeAr(s).replace(/\s+/g, '');
const used = new Map();
const match = new Map(); // serial ← سجل
const take = (p, r) => { used.set(r.id, p); match.set(p.serial, r); };
// 1) الاسم نفسه. إن تكرر الاسم (شخصان مختلفان بالاسم نفسه) يُفضَّل من يحمل الرقم نفسه، وإلا بالترتيب.
for (const p of list) {
  const c = rows.filter((r) => !used.has(r.id) && compact(r.name) === compact(p.name));
  if (!c.length) continue;
  const same = list.filter((x) => compact(x.name) === compact(p.name));
  if (c.length === 1 && same.length === 1) take(p, c[0]);
  else if (same.length > 1) {
    const held = c.find((r) => r.list_serial === p.serial);
    if (held) take(p, held);
  } else take(p, c.sort((a, b) => (a.seq ?? 1e9) - (b.seq ?? 1e9))[0]);
}
for (const p of list) {
  if (match.has(p.serial)) continue;
  const same = list.filter((x) => compact(x.name) === compact(p.name) && !match.has(x.serial));
  const c = rows.filter((r) => !used.has(r.id) && compact(r.name) === compact(p.name)).sort((a, b) => (a.seq ?? 1e9) - (b.seq ?? 1e9));
  if (c.length && c.length >= same.length) take(p, c[same.indexOf(p)] || c[0]);
}
// 2) اسم مقطوع، ما لم يطابق شخصًا آخر في الملف تمامًا.
for (const p of list) {
  if (match.has(p.serial)) continue;
  const c = rows.filter((r) => !used.has(r.id) && !list.some((x) => x !== p && compact(x.name) === compact(r.name))
    && (compact(r.name).startsWith(compact(p.name)) || compact(p.name).startsWith(compact(r.name))));
  if (c.length === 1) take(p, c[0]);
}
const moves = list.filter((p) => match.has(p.serial)).map((p) => ({ p, b: match.get(p.serial) }))
  .filter(({ p, b }) => b.intake_batch !== BATCH || b.list_serial !== p.serial || b.seq !== p.serial || (!b.dob && p.dob));
const adds = list.filter((p) => !match.has(p.serial));
const orphans = rows.filter((r) => !used.has(r.id));
const lbl = (r) => (r.intake_batch ? `د${r.intake_batch}·${r.list_serial} (عام ${r.seq ?? '—'})` : '—');

// العائلة المطلوبة لكل رقم حسب ترتيب الملف. الصلة من المنظومة إن وُجد السجل (قد يكون المدقق صحّحها).
// مفتاح العائلة: مفتاح سجل الموظف الحالي إن لم يأخذه موظف قبله، وإلا مفتاح جديد.
const plan = new Map();
{
  let cur = null;
  const taken = new Set();
  for (const p of [...list].sort((a, b) => a.serial - b.serial)) {
    const b = match.get(p.serial);
    const rel = b ? b.relation : p.relation;
    if (isPrincipal(rel) || !cur) {
      const own = b?.job_no || p.job || b?.family_key;
      const key = own && !taken.has(own) ? own : `L${BATCH}-${p.serial}`;
      taken.add(key);
      cur = { key, head: isPrincipal(rel) ? (b ? b.name : p.name) : null };
    }
    plan.set(p.serial, cur);
  }
}
const regroup = !REGROUP ? [] : list.filter((p) => match.has(p.serial)).map((p) => ({ p, b: match.get(p.serial), to: plan.get(p.serial) }))
  .filter(({ b, to }) => b.family_key !== to.key || (to.head && b.employee_name !== to.head));

console.log(`الجهة: ${entity.name_ar}`, { 'في الملف': list.length, 'مطابق': match.size, 'يتغير رقمه': moves.length, 'يُضاف': adds.length, 'ليس في الملف': orphans.length });
console.log('\nيتغير رقمه:');
for (const { p, b } of moves) console.log(`  ${b.name}: ${lbl(b)} ← د${BATCH}·${p.serial} (عام ${p.serial})${!b.dob && p.dob ? ` + المواليد ${p.dob}` : ''}`);
console.log('\nيُضاف:');
for (const p of adds) console.log(`  د${BATCH}·${p.serial} ${p.name} (${p.relation || 'بلا صلة'}، ${p.dob || 'بلا مواليد'})`);
if (REGROUP) {
  console.log(`\nتتغير عائلته (${regroup.length}):`);
  for (const { p, b, to } of regroup) console.log(`  ${p.serial} ${b.name} (${b.relation || '—'}): موظفه ${b.employee_name || '—'} ← ${to.head || '— بلا موظف في الملف —'}`);
}
console.log('\nليس في الملف (يبقى، ويفقد رقمه):');
for (const r of orphans) console.log(`  ${lbl(r)} ${r.name} (${r.relation}) · ${r.review_status}${r.photo_file ? ' · بصورة' : ''}`);
if (!apply) {
  console.log('\nتجربة فقط؛ أضف --apply للتنفيذ.');
  process.exit(0);
}

const backup = path.join(DATA_DIR, `app.before-list-sync-${Date.now()}.db`);
db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
console.log(`\nنسخة احتياطية: ${backup}`);
const at = nowIso();
const ev = db.prepare('INSERT INTO beneficiary_events (beneficiary_id, action, field, old_value, new_value, reason, actor, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
tx(db, () => {
  const clear = db.prepare('UPDATE beneficiaries SET list_serial = NULL, seq = NULL WHERE id = ?');
  for (const { b } of moves) clear.run(b.id);
  for (const r of orphans) if (r.list_serial != null || r.seq != null) {
    clear.run(r.id);
    ev.run(r.id, 'list_sync', 'list_serial', lbl(r), '', 'ليس في قائمة الجهة', ACTOR, at);
  }
  const set = db.prepare('UPDATE beneficiaries SET intake_batch = ?, list_serial = ?, seq = ?, dob = COALESCE(NULLIF(dob, \'\'), ?), version = version + 1, updated_at = ? WHERE id = ?');
  for (const { p, b } of moves) {
    set.run(BATCH, p.serial, p.serial, p.dob || null, at, b.id);
    ev.run(b.id, 'list_sync', 'list_serial', lbl(b), `د${BATCH}·${p.serial}`, 'رقمه في قائمة الجهة', ACTOR, at);
  }
  // الإضافة بترتيب الملف: الموظف يبدأ عائلة، ومن بعده يتبعونه حتى الموظف التالي.
  const famOf = new Map(list.filter((p) => match.has(p.serial)).map((p) => [p.serial, match.get(p.serial)]));
  const ins = db.prepare(
    `INSERT INTO beneficiaries (entity_id, family_key, job_no, employee_name, name, relation, dob, national_id, intake_batch, list_serial, seq, legacy_status, search_key, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'نشط', ?, ?)`
  );
  for (const p of [...list].sort((a, b) => a.serial - b.serial)) {
    if (famOf.get(p.serial)) continue;
    const { key: fam, head } = plan.get(p.serial);
    const row = { family_key: fam, job_no: p.job || null, employee_name: head, name: p.name, relation: p.relation, dob: p.dob || null, national_id: p.national || null };
    const { lastInsertRowid } = ins.run(entity.id, row.family_key, row.job_no, row.employee_name, row.name, row.relation, row.dob, row.national_id,
      BATCH, p.serial, p.serial, buildSearchKey(row), at);
    ev.run(Number(lastInsertRowid), 'add', null, null, null, `في قائمة الجهة برقم ${p.serial} ولم يكن في المنظومة`, ACTOR, at);
  }
  const fam = db.prepare('UPDATE beneficiaries SET family_key = ?, employee_name = ?, search_key = ?, version = version + 1, updated_at = ? WHERE id = ?');
  for (const { b, to } of regroup) {
    const emp = to.head || b.employee_name;
    fam.run(to.key, emp, buildSearchKey({ ...b, employee_name: emp }), at, b.id);
    ev.run(b.id, 'merge', 'family_key', b.family_key, to.key, `عائلته حسب ترتيب قائمة الجهة (الموظف: ${to.head || '—'})`, ACTOR, at);
  }
});
console.log(`تم: ${moves.length} تغيّر رقمه، ${adds.length} أُضيف، ${regroup.length} تغيّرت عائلته، ${orphans.length} ليس في الملف.`);
