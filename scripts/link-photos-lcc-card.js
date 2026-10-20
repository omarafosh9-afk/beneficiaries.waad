// يربط صور مجلد "LCC CARD" (مصدر إضافي لشركة الاسمنت فقط) بالأشخاص.
// تنبيه مهم: اسم الفولدر الرقمي في DONE2026/NEW DONE ليس بالضرورة رقم البطاقة ولا
// الرقم الوظيفي الحقيقي (ثبت بالتدقيق أن ~27% من الحالات فيها فولدر برقم مختلف تماما
// عن بطاقة الشخص الفعلية) - لذلك أُلغي تماما أي تخمين اعتمادا على رقم الفولدر.
// المطابقة الوحيدة المعتمدة الآن: رقم بطاقة صريح في اسم الفولدر/الملف، أو اسم مسجل
// في ملف .card المرافق للصورة (المصدر الرسمي للاسم) بتطابق دقيق وفريد.
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const sharp = require('sharp');

const ROOT = 'c:\\Users\\Omar\\Desktop\\الاسمنت كامل خام\\LCC CARD';
const MERGE_FILE = 'c:\\Users\\Omar\\Desktop\\الاسمنت كامل خام\\تحليل بيانات شركة الاسمنت\\دمج الاسمنت.xlsx';
const APP_DIR = path.join(__dirname, '..');
const CARD_PATTERN = /^LCC2025\d+([A-Z]+\d*)?$/i;
const IMG_EXT = new Set(['.jpg', '.jpeg', '.png']);

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

function main() {
  // 1) ابنِ فهرس ID NO -> [بطاقات العائلة] من دمج الاسمنت.xlsx
  const wb0 = XLSX.readFile(MERGE_FILE);
  const ws0 = wb0.Sheets[wb0.SheetNames[0]];
  const rows0 = XLSX.utils.sheet_to_json(ws0, { header: 1, defval: '' });
  const idNoToCards = new Map();
  for (const r of rows0.slice(1)) {
    const idNo = String(r[1] || '').trim();
    const card = String(r[2] || '').trim().toUpperCase();
    if (!idNo || !card) continue;
    if (!idNoToCards.has(idNo)) idNoToCards.set(idNo, []);
    idNoToCards.get(idNo).push(card);
  }

  // 2) حمّل قاعدة الأشخاص (الاسمنت فقط) وابنِ فهارس
  const people = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'data', 'people.json'), 'utf-8'));
  const cementPeople = people.filter((p) => p.company === 'Cement');
  const byCard = new Map();
  const byNameKey = new Map();
  for (const p of cementPeople) {
    for (const c of [p.card1, p.card2]) if (c) byCard.set(c.toUpperCase(), p);
    const k = matchKey(p.name);
    if (!byNameKey.has(k)) byNameKey.set(k, []);
    byNameKey.get(k).push(p);
  }

  // 3) امشِ كل الشجرة واجمع كل صور الأشخاص مع المجلد الحاوي (وحدة الربط)
  function walk(dir) {
    const out = [];
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) out.push(...walk(p));
      else {
        const ext = path.extname(f.name).toLowerCase();
        if (IMG_EXT.has(ext)) out.push({ file: p, folder: dir, base: path.basename(f.name, ext) });
      }
    }
    return out;
  }
  const images = walk(ROOT);

  const stats = { linkedByCard: 0, linkedByFolderCard: 0, linkedByIdNo: 0, linkedByName: 0, alreadyLinked: 0, noMatch: 0, converted: 0 };
  const unmatched = [];
  const results = [];

  for (const img of images) {
    const folderName = path.basename(img.folder).trim();
    let person = null;
    let matchedBy = '';

    // أ) اسم المجلد رقم بطاقة مباشر
    if (CARD_PATTERN.test(folderName)) {
      person = byCard.get(folderName.toUpperCase()) || null;
      if (person) matchedBy = 'folder-card';
    }

    // ب) اسم الملف نفسه اسم شخص (تطابق دقيق)
    if (!person) {
      const cleanBase = img.base.replace(/^Scan_\d+.*/i, '').replace(/[0-9a-f-]{20,}/i, '').trim();
      if (cleanBase) {
        const cands = byNameKey.get(matchKey(cleanBase)) || [];
        if (cands.length === 1) { person = cands[0]; matchedBy = 'filename'; }
      }
    }

    // ج) اسم مسجل في ملف .card مرافق لنفس المجلد (المصدر الرسمي الحقيقي للاسم)
    // ملاحظة: رقم الفولدر نفسه غير موثوق إطلاقا كرقم بطاقة أو رقم وظيفي (ثبت بالتدقيق
    // أنه رقم طلب/إحالة داخلي لا علاقة له برقم البطاقة الفعلي في نحو ربع الحالات).
    if (!person) {
      let cardFiles = [];
      try { cardFiles = fs.readdirSync(img.folder).filter((f) => f.toLowerCase().endsWith('.card')); } catch (e) {}
      if (cardFiles.length === 1) {
        const regName = path.basename(cardFiles[0], '.card');
        const cands = byNameKey.get(matchKey(regName)) || [];
        if (cands.length === 1) { person = cands[0]; matchedBy = 'card-file-name'; }
      }
    }

    if (!person) {
      stats.noMatch++;
      if (unmatched.length < 40) unmatched.push({ file: path.relative(ROOT, img.file), folder: folderName });
      continue;
    }

    if (matchedBy === 'folder-card') stats.linkedByCard++;
    else if (matchedBy === 'filename') stats.linkedByName++;
    else stats.linkedByCardFile = (stats.linkedByCardFile || 0) + 1;

    results.push({ img, person });
  }

  return { results, stats, unmatched };
}

async function run() {
  const { results, stats, unmatched } = main();

  for (const { img, person } of results) {
    const outDir = path.join(APP_DIR, 'public', 'storage', person.company);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${person.photoSlug}.webp`);
    if (fs.existsSync(outPath)) { stats.alreadyLinked++; continue; }
    try {
      await sharp(img.file).resize(500, 500, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toFile(outPath);
      stats.converted++;
    } catch (e) {
      console.log('فشل تحويل:', img.file, e.message);
    }
  }

  console.log('\n=== ملخص ربط LCC CARD ===');
  console.log('تم تحويلها الآن:', stats.converted);
  console.log('  - عبر رقم البطاقة (اسم المجلد):', stats.linkedByCard);
  console.log('  - عبر اسم مسجل في ملف .card:', stats.linkedByCardFile || 0);
  console.log('  - عبر تطابق اسم الملف:', stats.linkedByName);
  console.log('موجودة مسبقا (تم تخطيها):', stats.alreadyLinked);
  console.log('بلا مطابقة:', stats.noMatch);
  if (unmatched.length) {
    console.log('\nعينة بلا مطابقة:');
    for (const u of unmatched) console.log(' ', u);
  }
}

run();
