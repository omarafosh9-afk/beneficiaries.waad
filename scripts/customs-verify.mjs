// يتحقق من ورقة «التعارضات» بعد تعديلها يدويًا: هل اتفقت الأسماء والمواليد في كل صف؟
// الاستخدام: node scripts/customs-verify.mjs "<ملف القائمة الموحدة>"
import { createRequire } from 'node:module';
import { normalizeAr } from '../lib/derive.js';

const XLSX = createRequire(import.meta.url)('xlsx');
const file = process.argv[2] || 'C:/Users/Omar/Desktop/الجمارك القائمة الكاملة/قائمة الجمارك الموحدة.xlsx';
const wb = XLSX.readFile(file);
const rows = XLSX.utils.sheet_to_json(wb.Sheets['التعارضات'], { defval: '', raw: false });
const split = (v) => String(v || '').split('|').map((s) => s.trim()).filter(Boolean);
const NAMES = ['الاسم - TPA', 'الاسم - الأسنان', 'الاسم - المنظومة'];
const DOBS = ['المواليد - TPA', 'المواليد - الأسنان', 'المواليد - المنظومة'];

// نفس التاريخ بصيغ مختلفة (23-3-1979 = 23/03/1979، و0024/03/30 = 30/03/0024) يُعدّ واحدًا.
function normDob(s) {
  const t = String(s).trim();
  let m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return t;
}
const badYear = (d) => { const y = Number(d.slice(0, 4)); return y < 1900 || y > new Date().getFullYear(); };

const ok = [];
const left = {};
for (const r of rows) {
  const names = NAMES.flatMap((k) => split(r[k]));
  const dobs = DOBS.flatMap((k) => split(r[k])).map(normDob);
  const p = [];
  if (new Set(names.map(normalizeAr)).size > 1) p.push('الاسم ما زال مختلفًا');
  if (!dobs.length) p.push('بلا مواليد');
  else if (new Set(dobs).size > 1) p.push('المواليد ما زالت مختلفة');
  else if (badYear(dobs[0])) p.push('سنة الميلاد غير منطقية');
  // التكرار بنفس القيم ليس تعارضًا (يُحذف المكرر عند الدمج)؛ يبقى تعارضًا فقط إن اختلفت قيمه.
  const dupDiffers = NAMES.some((k) => new Set(split(r[k]).map(normalizeAr)).size > 1)
    || DOBS.some((k) => new Set(split(r[k]).map(normDob)).size > 1);
  if (dupDiffers) p.push('مكرر داخل مصدر بقيم مختلفة');
  if (!p.length) ok.push(r);
  else for (const x of p) (left[x] ??= []).push(r);
}
console.log(`الصفوف: ${rows.length} — محلولة: ${ok.length} — باقية: ${rows.length - ok.length}`);
for (const [k, v] of Object.entries(left)) {
  console.log(`\n${k}: ${v.length}`);
  for (const r of v.slice(0, 8)) {
    console.log(`  ${r['رقم البطاقة']} | ${NAMES.map((n) => r[n] || '-').join(' / ')} | ${DOBS.map((n) => r[n] || '-').join(' / ')}`);
  }
}
