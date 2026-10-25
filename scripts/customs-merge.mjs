// قائمة الجمارك الموحّدة: دمج قائمة TPA وقائمة الأسنان والمنظومة حسب رقم البطاقة.
// ورقة «القائمة الموحدة»: اسم المستفيد، رقم البطاقة، المواليد، الحالة.
// ورقة «التعارضات»: كل سجل اختلفت فيه المصادر، بقيم كل مصدر، لمراجعته.
// قاعدة الاختيار عند الاختلاف: القيمة التي يتفق عليها مصدران أو أكثر، وإلا قيمة TPA ثم الأسنان ثم المنظومة.
// الاستخدام: node scripts/customs-merge.mjs "<مجلد القائمتين>" [ملف المخرجات]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { openDb } from '../lib/db-node.js';
import { normalizeAr } from '../lib/derive.js';

const XLSX = createRequire(import.meta.url)('xlsx');
// الاستخدام الكامل:
//   node scripts/customs-merge.mjs "<المجلد>" [--out ملف] [--resolved ملف_موحد_معدل.xlsx] [--decisions قرارات.json]
// --resolved: ورقة «التعارضات» بعد تعديلها يدويًا؛ كل صف اتفقت فيه الأسماء والمواليد يُعتمد كما هو.
// --decisions: قرارات معتمدة لأرقام بطاقات بعينها، وأشخاص يحملون رقم غيرهم (extra).
const argv = process.argv.slice(2);
const opt = (k) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : null);
const dir = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'C:/Users/Omar/Desktop/الجمارك القائمة الكاملة';
const outFile = opt('out') || path.join(dir, 'قائمة الجمارك الموحدة.xlsx');

const read = (re) => {
  const f = fs.readdirSync(dir).find((n) => re.test(n) && !n.startsWith('~$'));
  if (!f) throw new Error('لم يُعثر على ملف يطابق ' + re);
  const wb = XLSX.readFile(path.join(dir, f));
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
};

// رقم البطاقة بصيغة موحّدة: بلا أصفار بادئة بعد JMR2025.
const card = (c) => {
  const s = String(c || '').trim().toUpperCase();
  const m = /^(JMR2025)(VIP)?0*(\d+)([A-Z]+\d*)?$/.exec(s);
  return m ? `${m[1]}${m[2] || ''}${m[3]}${m[4] || ''}` : s;
};
const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
// كل صيغ التاريخ الموجودة ← YYYY-MM-DD.
function dob(v) {
  if (v === '' || v === null || v === undefined || v === 'لا') return '';
  if (typeof v === 'string' && /^\d{5}$/.test(v.trim())) v = Number(v);
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const s = String(v).trim().replace(/[٠-٩]/g, (ch) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch)));
  const am = /^(\S+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (am && AR_MONTHS.includes(am[1])) return `${am[3]}-${String(AR_MONTHS.indexOf(am[1]) + 1).padStart(2, '0')}-${am[2].padStart(2, '0')}`;
  let m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(s);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : s;
}
const show = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d);
const clean = (n) => String(n || '').replace(/\s+/g, ' ').trim();

// المصادر الثلاثة: خريطة رقم البطاقة ← {name, dob}. التكرار داخل القائمة يُحفظ كقائمة.
const sources = { TPA: new Map(), 'الأسنان': new Map(), 'المنظومة': new Map() };
const add = (src, c, rec) => {
  if (!c) return;
  const m = sources[src];
  if (!m.has(c)) m.set(c, []);
  m.get(c).push(rec);
};
for (const r of read(/tpa/i)) {
  add('TPA', card(r.card_number || (r.relationship === 'PRINCIPAL' ? r.principal_card_number : '')), { name: clean(r.full_name), dob: dob(r.birth_date) });
}
for (const r of read(/أسنان/)) add('الأسنان', card(r['رقم البطاقة']), { name: clean(r['الاسم']), dob: dob(r['تاريخ الميلاد']) });
const db = openDb();
for (const r of db.prepare('SELECT * FROM beneficiaries WHERE entity_id = 3 AND deleted = 0').all()) {
  add('المنظومة', card(r.card1 || r.card2), { name: clean(r.name), dob: dob(r.dob) });
}

// يختار القيمة: الأكثر اتفاقًا بين المصادر، وعند التعادل حسب ترتيب المصادر.
function pick(values, key = (v) => v) {
  const present = values.filter((v) => v.value);
  if (!present.length) return { value: '', agree: true };
  const groups = new Map();
  for (const v of present) {
    const k = key(v.value);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(v);
  }
  const best = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  return { value: best[0].value, agree: groups.size === 1, groups: groups.size };
}

// قرارات المراجعة: رقم البطاقة ← { name, dob, source }.
const overrides = new Map();
const split = (v) => String(v || '').split('|').map((s) => s.trim()).filter(Boolean);
if (opt('resolved')) {
  const rwb = XLSX.readFile(opt('resolved'));
  for (const r of XLSX.utils.sheet_to_json(rwb.Sheets['التعارضات'], { defval: '', raw: false })) {
    const names = ['الاسم - TPA', 'الاسم - الأسنان', 'الاسم - المنظومة'].flatMap((k) => split(r[k]));
    const dobs = ['المواليد - TPA', 'المواليد - الأسنان', 'المواليد - المنظومة'].flatMap((k) => split(r[k])).map(dob);
    if (names.length && new Set(names.map(normalizeAr)).size === 1 && dobs.length && new Set(dobs).size === 1) {
      overrides.set(card(r['رقم البطاقة']), { name: names[0], dob: dobs[0], source: 'مراجعة يدوية' });
    }
  }
}
let extra = [];
if (opt('decisions')) {
  const dec = JSON.parse(fs.readFileSync(opt('decisions'), 'utf8'));
  for (const [c, v] of Object.entries(dec.cards || {})) overrides.set(card(c), { ...v, dob: dob(v.dob) });
  extra = dec.extra || [];
}

const merged = [];
const conflicts = [];
const all = [...new Set(Object.values(sources).flatMap((m) => [...m.keys()]))].sort();
for (const c of all) {
  const per = Object.entries(sources).map(([src, m]) => ({ src, recs: m.get(c) || [] }));
  const here = per.filter((p) => p.recs.length).map((p) => p.src);
  // التكرار بنفس القيم ليس تعارضًا؛ يُعدّ تعارضًا فقط إن اختلف الاسم أو المواليد بين النسخ.
  const dupIn = per
    .filter((p) => p.recs.length > 1 && (new Set(p.recs.map((r) => normalizeAr(r.name))).size > 1 || new Set(p.recs.map((r) => r.dob)).size > 1))
    .map((p) => p.src);
  const ov = overrides.get(c);
  if (ov) {
    merged.push({ 'اسم المستفيد': ov.name, 'رقم البطاقة': c, 'المواليد': show(ov.dob), 'الحالة': `معتمد بعد المراجعة (${ov.source})` });
    continue;
  }
  const names = per.flatMap((p) => p.recs.map((r) => ({ src: p.src, value: r.name })));
  const dobs = per.flatMap((p) => p.recs.map((r) => ({ src: p.src, value: r.dob })));
  const name = pick(names, normalizeAr);
  const birth = pick(dobs);

  const problems = [];
  if (dupIn.length) problems.push(`مكرر في ${dupIn.join(' و')}`);
  if (!name.agree) problems.push('اختلاف الاسم');
  if (!birth.agree) problems.push('اختلاف المواليد');
  if (!birth.value) problems.push('بلا مواليد');
  if (here.length < 3) problems.push(`غير موجود في ${['TPA', 'الأسنان', 'المنظومة'].filter((s) => !here.includes(s)).join(' و')}`);

  let status = 'مطابق في المصادر الثلاثة';
  if (problems.some((p) => p !== `غير موجود في ${['TPA', 'الأسنان', 'المنظومة'].filter((s) => !here.includes(s)).join(' و')}`)) status = 'تعارض — راجع ورقة التعارضات';
  else if (here.length < 3) status = `موجود في ${here.join(' و')} فقط`;

  merged.push({ 'اسم المستفيد': name.value, 'رقم البطاقة': c, 'المواليد': show(birth.value), 'الحالة': status });
  if (status.startsWith('تعارض')) {
    const val = (src, f) => (per.find((p) => p.src === src).recs.map((r) => (f === 'dob' ? show(r[f]) : r[f])).filter(Boolean).join(' | '));
    conflicts.push({
      'رقم البطاقة': c,
      'نوع التعارض': problems.filter((p) => !p.startsWith('غير موجود')).join('، '),
      'الاسم - TPA': val('TPA', 'name'),
      'الاسم - الأسنان': val('الأسنان', 'name'),
      'الاسم - المنظومة': val('المنظومة', 'name'),
      'المواليد - TPA': val('TPA', 'dob'),
      'المواليد - الأسنان': val('الأسنان', 'dob'),
      'المواليد - المنظومة': val('المنظومة', 'dob'),
      'المختار في القائمة': `${name.value} — ${show(birth.value) || 'بلا مواليد'}`,
      'القرار': '',
    });
  }
}

// أشخاص يحملون رقم بطاقة شخص آخر: في القائمة بلا رقم، وفي التعارضات لإعطائهم رقمًا صحيحًا.
for (const e of extra) {
  merged.push({ 'اسم المستفيد': e.name, 'رقم البطاقة': '', 'المواليد': show(dob(e.dob)), 'الحالة': 'تعارض — يحتاج رقم بطاقة جديد' });
  conflicts.push({
    'رقم البطاقة': `(كان ${e.was})`,
    'نوع التعارض': 'يحمل رقم بطاقة شخص آخر — يحتاج رقمًا جديدًا',
    'الاسم - TPA': e.name, 'الاسم - الأسنان': '', 'الاسم - المنظومة': '',
    'المواليد - TPA': show(dob(e.dob)), 'المواليد - الأسنان': '', 'المواليد - المنظومة': '',
    'المختار في القائمة': e.note, 'القرار': '',
  });
}

const wb = XLSX.utils.book_new();
wb.Workbook = { Views: [{ RTL: true }] };
for (const [nm, list, widths] of [
  ['القائمة الموحدة', merged, [38, 20, 14, 34]],
  ['التعارضات', conflicts, [20, 34, 32, 32, 32, 14, 14, 14, 40, 20]],
]) {
  const ws = XLSX.utils.json_to_sheet(list);
  ws['!views'] = [{ RTL: true }];
  ws['!cols'] = widths.map((w) => ({ wch: w }));
  ws['!autofilter'] = { ref: ws['!ref'] };
  XLSX.utils.book_append_sheet(wb, ws, nm);
}
XLSX.writeFile(wb, outFile);
const count = {};
for (const r of merged) count[r['الحالة']] = (count[r['الحالة']] || 0) + 1;
console.log('القائمة الموحدة:', merged.length, '— التعارضات:', conflicts.length);
console.table(count);
console.log('الملف: ' + outFile);
