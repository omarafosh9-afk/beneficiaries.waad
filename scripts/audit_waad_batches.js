const path = require('path');
const fs = require('fs');

const ROOT = 'c:\\Users\\Omar\\Desktop\\سطح مكتب جهاز الشركة وعد';
const APP_DIR = 'c:\\Users\\Omar\\Desktop\\الاسمنت كامل خام\\تحليل بيانات شركة الاسمنت\\beneficiary-viewer';
const BATCH_DIRS = [
  '2986 اسمنت', 'الدفعة10 جمارك', 'الدفعة6-جليانه', 'بدل فاقد جليانة _ جود',
  'تصحيح جليانه', 'جليانة _ 32143', 'جليانة الدفعة الخامسة', 'جليانة الدفعة7',
  'جليانة دفعة 4', 'نواقص الدفعة الثانية جمارك 23335',
];

const BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
function cleanName(v) { return v ? String(v).replace(BIDI, '').replace(/\s+/g, ' ').trim() : ''; }
function matchKey(name) {
  let n = cleanName(name);
  n = n.replace(/[\u064B-\u065F\u0670\u0640]/g, '');
  n = n.replace(/[أإآٱ]/g, 'ا').replace(/[ىئ]/g, 'ي').replace(/ؤ/g, 'و').replace(/ة/g, 'ه');
  return n.replace(/\s+/g, ' ').trim();
}

function walk(dir) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const f of entries) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const people = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'data', 'people.json'), 'utf-8'));
const byNameKey = new Map();
for (const p of people) {
  const k = matchKey(p.name);
  if (!byNameKey.has(k)) byNameKey.set(k, []);
  byNameKey.get(k).push(p);
}

let checked = 0, ok = 0, bad = [];
for (const batchDir of BATCH_DIRS) {
  const full = path.join(ROOT, batchDir);
  const files = walk(full);
  const cardFiles = files.filter((f) => f.toLowerCase().endsWith('.card'));
  for (const cf of cardFiles) {
    const folderName = path.basename(path.dirname(cf)).replace(/^0+/, '') || '0';
    if (!/^\d+$/.test(folderName)) continue;
    const regName = path.basename(cf, '.card');
    const cands = byNameKey.get(matchKey(regName)) || [];
    if (!cands.length) { checked++; bad.push({ batchDir, folderName, regName, note: 'not found in db at all' }); continue; }
    checked++;
    const found = cands.some((p) => {
      const m = (p.card1 || p.card2 || '').match(/^[A-Z]+2025(\d+)/i);
      return m && (m[1].replace(/^0+/, '') || '0') === folderName;
    });
    if (found) ok++; else bad.push({ batchDir, folderName, regName, actualCards: cands.map(p=>p.card1||p.card2) });
  }
}
console.log(`تحققت من ${checked}، صحيح ${ok}، خطأ ${bad.length}`);
bad.forEach((b) => console.log(' ', b));
