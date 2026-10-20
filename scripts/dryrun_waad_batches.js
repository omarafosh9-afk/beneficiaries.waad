const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const ROOT = 'c:\\Users\\Omar\\Desktop\\سطح مكتب جهاز الشركة وعد';
const APP_DIR = path.join(__dirname, '..');
const IMG_EXT = new Set(['.jpg', '.jpeg', '.png']);
const BATCH_DIRS = ['2986 اسمنت', 'الدفعة10 جمارك', 'الدفعة6-جليانه', 'بدل فاقد جليانة _ جود', 'تصحيح جليانه', 'جليانة _ 32143', 'جليانة الدفعة الخامسة', 'جليانة الدفعة7', 'جليانة دفعة 4', 'نواقص الدفعة الثانية جمارك 23335'];
const CARD_PATTERN = /^(LCC2025|JFZ2025|JMR2025)\d+([A-Z]+\d*)?$/i;

const BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
function cleanName(v) { return v ? String(v).replace(BIDI, '').replace(/\s+/g, ' ').trim() : ''; }
function matchKey(name) {
  let n = cleanName(name);
  n = n.replace(/[\u064B-\u065F\u0670\u0640]/g, '');
  n = n.replace(/[أإآٱ]/g, 'ا').replace(/[ىئ]/g, 'ي').replace(/ؤ/g, 'و').replace(/ة/g, 'ه');
  return n.replace(/\s+/g, ' ').trim();
}
function firstWord(name) { const k = matchKey(name); return k.split(' ')[0] || ''; }

function walk(dir, exts) {
  const out = []; let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const f of entries) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) out.push(...walk(p, exts));
    else { const ext = path.extname(f.name).toLowerCase(); if (exts.has(ext)) out.push(p); }
  }
  return out;
}
function parseMasterList(file) {
  const wb = XLSX.readFile(file); const out = [];
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
    let headerIdx = -1;
    for (let i = 0; i < Math.min(3, rows.length); i++) if (rows[i].some((c) => String(c).includes('رقم البطاقة'))) { headerIdx = i; break; }
    if (headerIdx === -1) continue;
    const headers = rows[headerIdx];
    const cardCol = headers.findIndex((h) => String(h).includes('رقم البطاقة'));
    const nameCol = headers.findIndex((h) => String(h).includes('اسم المستفيد') || String(h).includes('اسم'));
    const dobCol = headers.findIndex((h) => String(h).includes('المواليد') || String(h).includes('ميلاد'));
    for (const r of rows.slice(headerIdx + 1)) {
      const card = String(r[cardCol] || '').trim().toUpperCase();
      const name = cleanName(r[nameCol]);
      if (!card || !name || !CARD_PATTERN.test(card)) continue;
      out.push({ card, name, dob: r[dobCol] || '' });
    }
  }
  return out;
}

const people = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'data', 'people.json'), 'utf-8'));
const byCard = new Map();
for (const p of people) for (const c of [p.card1, p.card2]) if (c) byCard.set(c.toUpperCase(), p);

const results = [];
for (const batchDir of BATCH_DIRS) {
  const full = path.join(ROOT, batchDir);
  if (!fs.existsSync(full)) continue;
  const xlsxFiles = walk(full, new Set(['.xlsx'])).filter((f) => !path.basename(f).startsWith('~$'));
  let entries = [];
  for (const xf of xlsxFiles) { try { entries.push(...parseMasterList(xf)); } catch (e) {} }
  const byBase = new Map();
  for (const e of entries) {
    const m = e.card.match(/^([A-Z]+2025)(\d+)/);
    if (!m) continue;
    const base = m[2].replace(/^0+/, '') || '0';
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(e);
  }
  const images = walk(full, IMG_EXT);
  for (const img of images) {
    const dir = path.dirname(img);
    const folderName = path.basename(dir).replace(/^0+/, '') || '0';
    if (!/^\d+$/.test(folderName)) continue;
    const family = byBase.get(folderName);
    if (!family || !family.length) continue;
    const base = path.basename(img, path.extname(img));
    const fw = firstWord(base);
    let entry = family.length === 1 ? family[0] : (family.find((e) => firstWord(e.name) === fw) || null);
    if (!entry) continue;
    const person = byCard.get(entry.card);

    // تحقق: هل يوجد ملف .card بنفس الفولدر؟ قارنه
    let cardFiles = [];
    try { cardFiles = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.card')); } catch (e) {}
    const regNames = cardFiles.map((f) => path.basename(f, '.card'));

    results.push({ batchDir, folder: folderName, img: path.basename(img), matchedName: entry.name, matchedCard: entry.card, personExists: !!person, regNames });
  }
}

const withCardFile = results.filter((r) => r.regNames.length);
let ok = 0, bad = [];
for (const r of withCardFile) {
  const match = r.regNames.some((rn) => matchKey(rn) === matchKey(r.matchedName));
  if (match) ok++; else bad.push(r);
}
console.log(`نتائج فيها ملف .card للتحقق: ${withCardFile.length}  صحيح: ${ok}  خطأ: ${bad.length}`);
bad.forEach((b) => console.log(' ', b));
console.log(`\nإجمالي كل المطابقات: ${results.length}`);
