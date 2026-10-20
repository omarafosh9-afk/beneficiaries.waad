// يربط صور مجلد "سطح مكتب جهاز الشركة وعد" (أرشيف عمل ضخم لعدة شركات) بأشخاص قاعدتنا.
// مطابقة آمنة فقط: رقم بطاقة صريح (في اسم المجلد أو الملف) أو تطابق دقيق لاسم الملف.
// لا اختراع لأي ربط - أي حالة غامضة تُترك بلا مطابقة.
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const ROOT = 'c:\\Users\\Omar\\Desktop\\سطح مكتب جهاز الشركة وعد';
const APP_DIR = path.join(__dirname, '..');
const IMG_EXT = new Set(['.jpg', '.jpeg', '.png']);
const SKIP_DIRS = new Set(['LOGO', 'قوالب البطاقات', 'نماذج بطاقات']);

const CARD_PATTERNS = {
  Cement: /LCC2025\d+([A-Z]+\d*)?/i,
  Jalyana: /JFZ2025\d+([A-Z]+\d*)?/i,
  Jamarek: /JMR2025\d+([A-Z]+\d*)?/i,
};
const ANY_CARD = /(LCC2025|JFZ2025|JMR2025)\d+([A-Z]+\d*)?/i;

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

function walk(dir) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const f of entries) {
    if (SKIP_DIRS.has(f.name)) continue;
    const p = path.join(dir, f.name);
    if (f.isDirectory()) out.push(...walk(p));
    else {
      const ext = path.extname(f.name).toLowerCase();
      if (IMG_EXT.has(ext)) out.push({ file: p, folder: dir, base: path.basename(f.name, ext) });
    }
  }
  return out;
}

async function main() {
  const people = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'data', 'people.json'), 'utf-8'));
  const byCard = new Map();
  const byNameKey = new Map();
  for (const p of people) {
    for (const c of [p.card1, p.card2]) if (c) byCard.set(c.toUpperCase(), p);
    const k = matchKey(p.name);
    if (!byNameKey.has(k)) byNameKey.set(k, []);
    byNameKey.get(k).push(p);
  }

  console.log('جاري مسح الشجرة...');
  const images = walk(ROOT);
  console.log(`إجمالي الصور: ${images.length}`);

  const stats = { linkedByCard: 0, linkedByName: 0, alreadyLinked: 0, noMatch: 0, converted: 0, ambiguous: 0 };
  const unmatched = [];
  const results = [];

  for (const img of images) {
    let person = null;
    let matchedBy = '';

    // أ) رقم بطاقة صريح في اسم الملف أو المجلد
    const folderName = path.basename(img.folder);
    const hay = folderName + ' ' + img.base;
    const m = hay.match(ANY_CARD);
    if (m) {
      person = byCard.get(m[0].toUpperCase()) || null;
      if (person) matchedBy = 'card';
    }

    // ب) تطابق دقيق لاسم الملف كاسم شخص (فريد فقط)
    if (!person) {
      const cleanBase = img.base.replace(/^(scan|whatsapp image|img)[\s_-].*/i, '').replace(/[0-9a-f-]{20,}/i, '').replace(/\(\d+\)/, '').trim();
      if (cleanBase && cleanBase.length > 2) {
        const cands = byNameKey.get(matchKey(cleanBase)) || [];
        if (cands.length === 1) { person = cands[0]; matchedBy = 'name'; }
        else if (cands.length > 1) stats.ambiguous++;
      }
    }

    if (!person) {
      stats.noMatch++;
      if (unmatched.length < 30) unmatched.push(path.relative(ROOT, img.file));
      continue;
    }
    if (matchedBy === 'card') stats.linkedByCard++; else stats.linkedByName++;
    results.push({ img, person });
  }

  for (const { img, person } of results) {
    const outDir = path.join(APP_DIR, 'public', 'storage', person.company);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${person.photoSlug}.webp`);
    if (fs.existsSync(outPath)) { stats.alreadyLinked++; continue; }
    try {
      await sharp(img.file).resize(500, 500, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toFile(outPath);
      stats.converted++;
    } catch (e) {
      // تجاهل ملفات تالفة
    }
  }

  console.log('\n=== ملخص ربط سطح مكتب وعد ===');
  console.log('تم تحويلها الآن:', stats.converted);
  console.log('  - عبر رقم البطاقة:', stats.linkedByCard);
  console.log('  - عبر تطابق الاسم:', stats.linkedByName);
  console.log('موجودة مسبقا (تخطي):', stats.alreadyLinked);
  console.log('أسماء غامضة (أكثر من شخص بنفس الاسم، تُركت):', stats.ambiguous);
  console.log('بلا مطابقة إطلاقا:', stats.noMatch);
  if (unmatched.length) {
    console.log('\nعينة بلا مطابقة:');
    for (const u of unmatched) console.log(' ', u);
  }
}

main();
