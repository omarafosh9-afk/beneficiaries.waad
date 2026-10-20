// يربط صور الدفعات الموسومة صراحة (جليانة/جمارك/اسمنت) داخل سطح مكتب وعد.
// كل دفعة فيها قائمة رسمية (رقم تسلسلي/باركود/اسم المستفيد/رقم البطاقة/المواليد)
// تربط رقم المجلد (الجزء الرقمي من البطاقة) بأفراد العائلة الحقيقيين ببطاقاتهم الصريحة.
// لا اختراع: المطابقة فقط عبر رقم بطاقة صريح موجود في القائمة الرسمية.
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const sharp = require('sharp');

const ROOT = 'c:\\Users\\Omar\\Desktop\\سطح مكتب جهاز الشركة وعد';
const APP_DIR = path.join(__dirname, '..');
const IMG_EXT = new Set(['.jpg', '.jpeg', '.png']);

const BATCH_DIRS = [
  '2986 اسمنت',
  'الدفعة10 جمارك',
  'الدفعة6-جليانه',
  'بدل فاقد جليانة _ جود',
  'تصحيح جليانه',
  'جليانة _ 32143',
  'جليانة الدفعة الخامسة',
  'جليانة الدفعة7',
  'جليانة دفعة 4',
  'نواقص الدفعة الثانية جمارك 23335',
];

const CARD_PATTERN = /^(LCC2025|JFZ2025|JMR2025)\d+([A-Z]+\d*)?$/i;
const COMPANY_OF_PREFIX = { LCC2025: 'Cement', JFZ2025: 'Jalyana', JMR2025: 'Jamarek' };

const BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
function cleanName(v) {
  if (!v) return '';
  return String(v).replace(BIDI, '').replace(/\s+/g, ' ').trim();
}
function matchKey(name) {
  let n = cleanName(name);
  n = n.replace(/[\u064B-\u065F\u0670\u0640]/g, '');
  n = n.replace(/[أإآٱ]/g, 'ا').replace(/[ىئ]/g, 'ي').replace(/ؤ/g, 'و').replace(/ة/g, 'ه');
  return n.replace(/\s+/g, ' ').trim();
}
function firstWord(name) {
  const k = matchKey(name);
  return k.split(' ')[0] || '';
}

function walk(dir, exts) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const f of entries) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) out.push(...walk(p, exts));
    else {
      const ext = path.extname(f.name).toLowerCase();
      if (exts.has(ext)) out.push(p);
    }
  }
  return out;
}

function parseMasterList(file) {
  const wb = XLSX.readFile(file);
  const out = [];
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
    let headerIdx = -1;
    for (let i = 0; i < Math.min(3, rows.length); i++) {
      if (rows[i].some((c) => String(c).includes('رقم البطاقة'))) { headerIdx = i; break; }
    }
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

async function main() {
  const people = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'data', 'people.json'), 'utf-8'));
  const byCard = new Map();
  for (const p of people) {
    for (const c of [p.card1, p.card2]) if (c) byCard.set(c.toUpperCase(), p);
  }

  const stats = { converted: 0, alreadyLinked: 0, noMatch: 0, newCandidates: 0 };
  const unmatched = [];
  const newPeople = [];

  for (const batchDir of BATCH_DIRS) {
    const full = path.join(ROOT, batchDir);
    if (!fs.existsSync(full)) continue;
    const xlsxFiles = walk(full, new Set(['.xlsx'])).filter((f) => !path.basename(f).startsWith('~$'));
    let entries = [];
    for (const xf of xlsxFiles) {
      try { entries.push(...parseMasterList(xf)); } catch (e) { /* تجاهل ملفات تالفة */ }
    }
    // فهرس: الجزء الرقمي من البطاقة -> كل البطاقات بنفس الرقم (العائلة)
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
      const folderName = path.basename(path.dirname(img)).replace(/^0+/, '') || '0';
      if (!/^\d+$/.test(folderName)) continue;
      const family = byBase.get(folderName);
      if (!family || !family.length) { stats.noMatch++; if (unmatched.length < 20) unmatched.push(path.relative(ROOT, img)); continue; }

      const base = path.basename(img, path.extname(img));
      const fw = firstWord(base);
      let entry = null;
      if (family.length === 1) entry = family[0];
      else entry = family.find((e) => firstWord(e.name) === fw) || null;

      if (!entry) { stats.noMatch++; if (unmatched.length < 20) unmatched.push(path.relative(ROOT, img)); continue; }

      let person = byCard.get(entry.card);
      if (!person) {
        stats.newCandidates++;
        newPeople.push(entry);
        continue;
      }

      const outDir = path.join(APP_DIR, 'public', 'storage', person.company);
      fs.mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, `${person.photoSlug}.webp`);
      if (fs.existsSync(outPath)) { stats.alreadyLinked++; continue; }
      try {
        await sharp(img).resize(500, 500, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toFile(outPath);
        stats.converted++;
      } catch (e) { /* تجاهل */ }
    }
  }

  console.log('=== ملخص ربط دفعات وعد الموسومة صراحة ===');
  console.log('تم تحويلها الآن:', stats.converted);
  console.log('موجودة مسبقا:', stats.alreadyLinked);
  console.log('بلا مطابقة (فولدر/اسم غير موجود بالقائمة):', stats.noMatch);
  console.log('أشخاص لهم بطاقة صريحة بالقائمة لكن غير موجودين في قاعدتنا (أشخاص جدد محتملون):', stats.newCandidates);
  if (unmatched.length) { console.log('\nعينة بلا مطابقة:'); unmatched.forEach((u) => console.log(' ', u)); }
  if (newPeople.length) {
    console.log('\nعينة أشخاص جدد محتملون (أول 30):');
    newPeople.slice(0, 30).forEach((e) => console.log(' ', e));
    fs.writeFileSync(path.join(__dirname, 'new_candidates_waad_batches.json'), JSON.stringify(newPeople, null, 2), 'utf-8');
    console.log(`\n(تم حفظ القائمة الكاملة (${newPeople.length}) في scripts/new_candidates_waad_batches.json)`);
  }
}

main();
