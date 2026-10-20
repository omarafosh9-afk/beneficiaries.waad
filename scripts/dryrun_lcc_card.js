// إعادة محاكاة منطق link-photos-lcc-card.js الأصلي (بلا تحويل فعلي) لمعرفة
// بالضبط من رُبط عبر أي طريقة، ثم تدقيق كل حالة cardbase/idno مقابل اسم .card الحقيقي.
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const ROOT = 'c:\\Users\\Omar\\Desktop\\الاسمنت كامل خام\\LCC CARD';
const MERGE_FILE = 'c:\\Users\\Omar\\Desktop\\الاسمنت كامل خام\\تحليل بيانات شركة الاسمنت\\دمج الاسمنت.xlsx';
const APP_DIR = 'c:\\Users\\Omar\\Desktop\\الاسمنت كامل خام\\تحليل بيانات شركة الاسمنت\\beneficiary-viewer';
const CARD_PATTERN = /^LCC2025\d+([A-Z]+\d*)?$/i;
const IMG_EXT = new Set(['.jpg', '.jpeg', '.png']);

const BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
function cleanName(v) { return v ? String(v).replace(BIDI, '').replace(/\s+/g, ' ').trim() : ''; }
function matchKey(name) {
  let n = cleanName(name);
  n = n.replace(/[\u064B-\u065F\u0670\u0640]/g, '');
  n = n.replace(/[أإآٱ]/g, 'ا').replace(/[ىئ]/g, 'ي').replace(/ؤ/g, 'و').replace(/ة/g, 'ه');
  return n.replace(/\s+/g, ' ').trim();
}

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

const results = [];
for (const img of images) {
  const folderName = path.basename(img.folder).trim();
  let person = null, matchedBy = '';
  if (CARD_PATTERN.test(folderName)) { person = byCard.get(folderName.toUpperCase()) || null; if (person) matchedBy = 'folder-card'; }
  if (!person) {
    const cleanBase = img.base.replace(/^Scan_\d+.*/i, '').replace(/[0-9a-f-]{20,}/i, '').trim();
    if (cleanBase) { const cands = byNameKey.get(matchKey(cleanBase)) || []; if (cands.length === 1) { person = cands[0]; matchedBy = 'filename'; } }
  }
  if (!person && /^\d+$/.test(folderName)) {
    const base = 'LCC2025' + String(parseInt(folderName, 10)).padStart(5, '0');
    const familyPeople = cementPeople.filter((p) => (p.card1 || '').toUpperCase().startsWith(base) || (p.card2 || '').toUpperCase().startsWith(base));
    if (familyPeople.length === 1) { person = familyPeople[0]; matchedBy = 'cardbase-single'; }
    else if (familyPeople.length > 1) {
      const cleanBase = img.base.replace(/^Scan_\d+.*/i, '').replace(/[0-9a-f-]{20,}/i, '').trim();
      const k = matchKey(cleanBase);
      const hit = familyPeople.find((p) => matchKey(p.name) === k);
      if (hit) { person = hit; matchedBy = 'cardbase-name'; }
    }
  }
  if (!person && /^\d+$/.test(folderName) && idNoToCards.has(folderName)) {
    const familyCards = idNoToCards.get(folderName);
    const familyPeople = familyCards.map((c) => byCard.get(c)).filter(Boolean);
    if (familyPeople.length === 1) { person = familyPeople[0]; matchedBy = 'idno-single'; }
    else if (familyPeople.length > 1) {
      const cleanBase = img.base.replace(/^Scan_\d+.*/i, '').replace(/[0-9a-f-]{20,}/i, '').trim();
      const k = matchKey(cleanBase);
      const hit = familyPeople.find((p) => matchKey(p.name) === k);
      if (hit) { person = hit; matchedBy = 'idno-name'; }
    }
  }
  if (person) results.push({ img: path.relative(ROOT, img.file), folder: img.folder, person: person.name, card: person.card1 || person.card2, photoSlug: person.photoSlug, matchedBy });
}

const suspect = results.filter((r) => r.matchedBy.startsWith('cardbase') || r.matchedBy.startsWith('idno'));
console.log('اجمالي المطابقات:', results.length, '  المشبوهة (cardbase/idno):', suspect.length);
fs.writeFileSync(path.join(__dirname, 'suspect_matches.json'), JSON.stringify(suspect, null, 2), 'utf-8');
for (const s of suspect) console.log(' ', s.folder.split('LCC CARD')[1], '|', s.img.split('\\').pop(), '->', s.person, s.matchedBy);
