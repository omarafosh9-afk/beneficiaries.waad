// مطابقة قائمتي الجمارك (منظومة TPA ومنظومة الأسنان) مع قاعدة المنظومة والصور.
// المفتاح: رقم البطاقة. المخرجات: ملف Excel للتعارضات (ورقة لكل نوع) لحلها قبل الدمج.
// الاستخدام: node scripts/customs-reconcile.mjs "<مجلد القائمتين>" [ملف المخرجات]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { openDb } from '../lib/db-node.js';
import { normalizeAr } from '../lib/derive.js';
import { STORAGE_DIR } from '../lib/photos.js';

const XLSX = createRequire(import.meta.url)('xlsx');
const dir = process.argv[2] || 'C:/Users/Omar/Desktop/الجمارك القائمة الكاملة';
const outFile = process.argv[3] || path.join(dir, 'تعارضات قائمتي الجمارك.xlsx');

const read = (re) => {
  const f = fs.readdirSync(dir).find((n) => re.test(n) && !n.startsWith('~$'));
  if (!f) throw new Error('لم يُعثر على ملف يطابق ' + re);
  const wb = XLSX.readFile(path.join(dir, f));
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
};
const tpaRows = read(/tpa/i);
const denRows = read(/أسنان/);

// رقم البطاقة بصيغة موحّدة: بلا أصفار بادئة بعد JMR2025 (JMR2025022887 = JMR202522887).
const card = (c) => {
  const s = String(c || '').trim().toUpperCase();
  const m = /^(JMR2025)(VIP)?0*(\d+)([A-Z]+\d*)?$/.exec(s);
  return m ? `${m[1]}${m[2] || ''}${m[3]}${m[4] || ''}` : s;
};
function dob(v) {
  if (v === '' || v === null || v === undefined || v === 'لا') return '';
  // تاريخ مخزّن كرقم تسلسلي من Excel (مثل 38324) في المنظومة أو القوائم.
  if (typeof v === 'string' && /^\d{5}$/.test(v.trim())) v = Number(v);
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  // أرقام عربية وأسماء أشهر عربية (مثل «أكتوبر ١٢, ١٩٧٤»).
  const s = String(v).trim().replace(/[٠-٩]/g, (ch) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch)));
  const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const am = /^(\S+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (am && AR_MONTHS.includes(am[1])) return `${am[3]}-${String(AR_MONTHS.indexOf(am[1]) + 1).padStart(2, '0')}-${am[2].padStart(2, '0')}`;
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? m[0] : s;
}
const REL = { PRINCIPAL: 'موظف أساسي', WIFE: 'زوجة', HUSBAND: 'زوج', SON: 'ابن', DAUGHTER: 'ابنة', FATHER: 'أب', MOTHER: 'أم' };

// TPA: الموظف قد لا يملك card_number فيُستخدم principal_card_number.
const T = new Map();
const tpaDup = [];
for (const r of tpaRows) {
  const c = card(r.card_number || (r.relationship === 'PRINCIPAL' ? r.principal_card_number : ''));
  if (!c) continue;
  if (T.has(c)) tpaDup.push([c, T.get(c), r]);
  T.set(c, r);
}
const Dn = new Map();
const denDup = [];
for (const r of denRows) {
  const c = card(r['رقم البطاقة']);
  if (!c) continue;
  if (Dn.has(c)) denDup.push([c, Dn.get(c), r]);
  Dn.set(c, r);
}
const db = openDb();
const Bm = new Map();
for (const r of db.prepare('SELECT * FROM beneficiaries WHERE entity_id = 3 AND deleted = 0').all()) {
  for (const c of [r.card1, r.card2]) if (c) Bm.set(card(c), r);
}

const sheets = {
  'ملخص': [],
  'مكرر داخل قائمة': [],
  'في TPA فقط': [],
  'في الأسنان فقط': [],
  'في المنظومة فقط': [],
  'اختلاف الاسم': [],
  'اختلاف المواليد': [],
  'بلا مواليد': [],
  'مشاكل الصور': [],
};
const tName = (t) => t?.full_name || '';
const dName = (d) => d?.['الاسم'] || '';

for (const [c, a, b] of tpaDup) sheets['مكرر داخل قائمة'].push({ 'القائمة': 'TPA', 'رقم البطاقة': c, 'الاسم 1': tName(a), 'الاسم 2': tName(b), 'القرار': '' });
for (const [c, a, b] of denDup) sheets['مكرر داخل قائمة'].push({ 'القائمة': 'الأسنان', 'رقم البطاقة': c, 'الاسم 1': dName(a), 'الاسم 2': dName(b), 'القرار': '' });

const all = [...new Set([...T.keys(), ...Dn.keys(), ...Bm.keys()])].sort();
for (const c of all) {
  const t = T.get(c), d = Dn.get(c), b = Bm.get(c);
  const base = { 'رقم البطاقة': c, 'اسم TPA': tName(t), 'اسم الأسنان': dName(d), 'اسم المنظومة': b?.name || '' };
  if (t && !d) sheets['في TPA فقط'].push({ ...base, 'الصلة': REL[t.relationship] || t.relationship, 'المواليد': dob(t.birth_date), 'في المنظومة': b ? 'نعم' : 'لا', 'القرار': '' });
  if (d && !t) sheets['في الأسنان فقط'].push({ ...base, 'المواليد': dob(d['تاريخ الميلاد']), 'في المنظومة': b ? 'نعم' : 'لا', 'القرار': '' });
  if (b && !t && !d) sheets['في المنظومة فقط'].push({ ...base, 'الصلة': b.relation, 'المواليد': b.dob || '', 'القرار': '' });

  const names = [tName(t), dName(d), b?.name].filter(Boolean);
  if (new Set(names.map(normalizeAr)).size > 1) sheets['اختلاف الاسم'].push({ ...base, 'الاسم المعتمد': '' });

  const dobs = { 'مواليد TPA': dob(t?.birth_date), 'مواليد الأسنان': dob(d?.['تاريخ الميلاد']), 'مواليد المنظومة': dob(b?.dob) };
  const known = Object.values(dobs).filter(Boolean);
  if (new Set(known).size > 1) sheets['اختلاف المواليد'].push({ ...base, ...dobs, 'المواليد المعتمد': '' });
  if (!known.length) sheets['بلا مواليد'].push({ ...base, 'المواليد المطلوب': '' });

  if (b) {
    const issue = [];
    if (!b.photo_file) issue.push('بلا صورة');
    else {
      if (!fs.existsSync(path.join(STORAGE_DIR, 'Jamarek', b.photo_file))) issue.push('ملف الصورة غير موجود');
      const m = /(JMR2025[A-Z0-9]+)\.webp$/i.exec(b.photo_file);
      if (m && card(m[1]) !== card(b.card1) && card(m[1]) !== card(b.card2)) issue.push(`اسم ملف الصورة لبطاقة أخرى: ${m[1]}`);
      const nameInFile = b.photo_file.replace(/_?JMR2025[A-Z0-9]+\.webp$/i, '');
      if (nameInFile && !/^\d+(-\d+)?$/.test(nameInFile) && normalizeAr(nameInFile) !== normalizeAr(b.name)) issue.push('اسم ملف الصورة لاسم مختلف');
    }
    if (issue.length && !(issue.length === 1 && issue[0] === 'بلا صورة')) {
      sheets['مشاكل الصور'].push({ ...base, 'ملف الصورة': b.photo_file || '', 'المشكلة': issue.join('، ') });
    }
  }
}
const noPhoto = [...Bm.values()].filter((b) => !b.photo_file).length;

sheets['ملخص'] = [
  ['سجلات قائمة TPA (ببطاقة)', T.size],
  ['سجلات قائمة الأسنان (ببطاقة)', Dn.size],
  ['سجلات الجمارك في المنظومة', new Set([...Bm.values()].map((b) => b.id)).size],
  ['في القائمتين معا', all.filter((c) => T.has(c) && Dn.has(c)).length],
  ...Object.entries(sheets).filter(([k]) => k !== 'ملخص').map(([k, v]) => [k, v.length]),
  ['بلا صورة في المنظومة (ليست تعارضًا)', noPhoto],
].map(([k, v]) => ({ 'البند': k, 'العدد': v }));

const wb = XLSX.utils.book_new();
wb.Workbook = { Views: [{ RTL: true }] };
for (const [name, list] of Object.entries(sheets)) {
  const ws = XLSX.utils.json_to_sheet(list.length ? list : [{ 'ملاحظة': 'لا يوجد' }]);
  ws['!views'] = [{ RTL: true }];
  XLSX.utils.book_append_sheet(wb, ws, name);
}
XLSX.writeFile(wb, outFile);
console.table(sheets['ملخص']);
console.log('الملف: ' + outFile);
