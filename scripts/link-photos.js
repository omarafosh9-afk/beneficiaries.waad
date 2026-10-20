// يربط صور مجلد WAAD (المرقّمة 1.jpg, 2.jpg...) بأشخاص قاعدة البيانات،
// عبر عمود التسلسل (SN) في ملفات القوائم المرافقة، ثم يحوّل كل صورة مطابقة
// إلى WebP ويحفظها في public/storage/<Company>/<الاسم>_<رقم البطاقة>.webp
// لا يُخترع أي ربط: فقط تطابق مؤكد برقم البطاقة أو تشابه قوي بالاسم.
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const sharp = require('sharp');

const WAAD = 'c:\\Users\\Omar\\Downloads\\WAAD-20260813T222340Z-1-001\\WAAD';
const APP_DIR = __dirname + '\\..';

const CARD_PATTERNS = {
  Cement: /^LCC2025\d+([A-Z]+\d*)?$/i,
  Jalyana: /^JFZ2025\d+([A-Z]+\d*)?$/i,
  Jamarek: /^JMR2025\d+([A-Z]+\d*)?$/i,
};

// كل زوج (قائمة + مجلد صور) مكتشف يدويا
const SOURCES = [
  { company: 'Cement', list: `${WAAD}\\LCC\\LCC_List.xlsx`, pics: `${WAAD}\\LCC\\Pictures`, snMode: 'col' },
  { company: 'Cement', list: `${WAAD}\\LCC\\LCC-3=old.xlsx`, pics: `${WAAD}\\LCC\\Pictures-LCC-3`, snMode: 'row' },
  { company: 'Jalyana', list: `${WAAD}\\Julyana\\jalyana-3.xlsx`, pics: `${WAAD}\\Julyana\\Picture`, snMode: 'col' },
  { company: 'Jamarek', list: `${WAAD}\\Customs\\Customs_8\\Customs_8.xlsx`, pics: `${WAAD}\\Customs\\Customs_8\\Pictures`, snMode: 'col' },
  { company: 'Jamarek', list: `${WAAD}\\Customs\\Old\\Customs_List.xlsx`, pics: `${WAAD}\\Customs\\Old\\Pictures`, snMode: 'col' },
  { company: 'Jamarek', list: `${WAAD}\\Customs\\Old\\Customs Batch 2\\Customs_List_batch2.xlsx`, pics: `${WAAD}\\Customs\\Old\\Customs Batch 2\\Pictures`, snMode: 'col' },
];

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
function wordSet(name) {
  return new Set(matchKey(name).split(' ').filter(Boolean));
}
function namesSimilar(a, b) {
  const wa = wordSet(a), wb = wordSet(b);
  if (!wa.size || !wb.size) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  const subset = [...wa].every((w) => wb.has(w)) || [...wb].every((w) => wa.has(w));
  return shared >= 2 || subset;
}

function findCol(headers, pattern) {
  for (let i = 0; i < headers.length; i++) {
    if (headers[i] && pattern.test(String(headers[i]).replace(/ـ/g, ''))) return i;
  }
  return -1;
}

function findCardColByValues(rows, pattern) {
  const counts = {};
  for (const row of rows.slice(0, 30)) {
    row.forEach((v, i) => {
      if (v && pattern.test(String(v).trim())) counts[i] = (counts[i] || 0) + 1;
    });
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries.length ? Number(entries[0][0]) : -1;
}

function findPhotoFile(dir, sn) {
  for (const ext of ['jpg', 'jpeg', 'png', 'JPG', 'JPEG', 'PNG']) {
    const p = path.join(dir, `${sn}.${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function main() {
  // 1) حمّل قاعدة الأشخاص وابنِ فهارس مطابقة
  const people = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'data', 'people.json'), 'utf-8'));
  const byCard = new Map();
  const byNameKey = new Map();
  for (const p of people) {
    for (const c of [p.card1, p.card2]) {
      if (c) byCard.set(c.toUpperCase(), p);
    }
    const k = matchKey(p.name);
    if (!byNameKey.has(k)) byNameKey.set(k, []);
    byNameKey.get(k).push(p);
  }

  const stats = { linkedByCard: 0, linkedByName: 0, noPhoto: 0, noMatch: 0, alreadyLinked: 0, converted: 0 };
  const unmatchedSamples = [];

  for (const src of SOURCES) {
    if (!fs.existsSync(src.list) || !fs.existsSync(src.pics)) {
      console.log(`⚠ تخطّي (ملف/مجلد غير موجود): ${src.list}`);
      continue;
    }
    const wb = XLSX.readFile(src.list);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    // ابحث عن صف الرأس (أول 3 صفوف)
    let headerRowIdx = 0;
    let headers = rows[0];
    for (let r = 0; r < Math.min(3, rows.length); r++) {
      const h = rows[r];
      if (findCol(h, /^SN$|^S\.?No$|تسلسل/i) !== -1) { headerRowIdx = r; headers = h; break; }
    }
    const snCol = findCol(headers, /^SN$|^S\.?No$|تسلسل/i);
    const nameCol = findCol(headers, /name|اسم/i);
    const cardPattern = CARD_PATTERNS[src.company];
    const dataRows = rows.slice(headerRowIdx + 1);
    let cardCol = findCol(headers, /card|بطاقة|profile/i);
    if (cardCol === -1 || !dataRows.some((r) => cardPattern.test(String(r[cardCol] || '').trim()))) {
      cardCol = findCardColByValues(dataRows, cardPattern);
    }

    let rowPosition = 0;
    let localLinked = 0, localSkipped = 0;
    for (const row of dataRows) {
      const name = cleanName(row[nameCol]);
      if (!name) continue;
      rowPosition++;
      let sn;
      if (src.snMode === 'col' && snCol !== -1 && row[snCol]) sn = String(row[snCol]).trim();
      else sn = String(rowPosition);
      if (!/^\d+$/.test(sn)) continue;

      const photoPath = findPhotoFile(src.pics, sn);
      if (!photoPath) { stats.noPhoto++; continue; }

      const card = cardCol !== -1 ? String(row[cardCol] || '').trim().toUpperCase() : '';
      let person = card ? byCard.get(card) : null;
      let matchedBy = 'card';
      if (!person) {
        const cands = byNameKey.get(matchKey(name)) || [];
        person = cands.find((p) => p.company === src.company) || null;
        if (!person) {
          // تشابه تقريبي ضمن نفس الشركة فقط
          const companyPeople = null; // تجنّب مسح كامل القائمة لكل صف (أداء) - نكتفي بالمطابقة الدقيقة والاسم الدقيق
        }
        matchedBy = 'name';
      }

      if (!person) {
        stats.noMatch++;
        if (unmatchedSamples.length < 15) unmatchedSamples.push({ src: path.basename(src.list), sn, name, card });
        continue;
      }

      const outDir = path.join(APP_DIR, 'public', 'storage', person.company);
      fs.mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, `${person.photoSlug}.webp`);
      if (fs.existsSync(outPath)) { stats.alreadyLinked++; continue; }

      try {
        await sharp(photoPath).resize(500, 500, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toFile(outPath);
        stats.converted++;
        if (matchedBy === 'card') stats.linkedByCard++; else stats.linkedByName++;
        localLinked++;
      } catch (e) {
        localSkipped++;
      }
    }
    console.log(`${path.basename(src.list)}: رُبط ${localLinked} صورة جديدة`);
  }

  console.log('\n=== ملخص الربط ===');
  console.log('تم ربطها وتحويلها الآن:', stats.converted, `(بالبطاقة: ${stats.linkedByCard} | بالاسم: ${stats.linkedByName})`);
  console.log('موجودة مسبقا (تم تخطيها):', stats.alreadyLinked);
  console.log('صور بلا رقم مطابق في القائمة:', stats.noPhoto);
  console.log('صفوف بلا صورة مطابقة الرقم:', stats.noPhoto);
  console.log('أسماء/بطاقات لم تُطابق أي شخص بقاعدة البيانات:', stats.noMatch);
  if (unmatchedSamples.length) {
    console.log('\nعينة من غير المطابق:');
    for (const s of unmatchedSamples) console.log(' ', s);
  }
}

main();
