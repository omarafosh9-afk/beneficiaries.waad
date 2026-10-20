// يحوّل ملفات الإكسل النظيفة الثلاثة إلى ملف بيانات JSON واحد يستخدمه التطبيق.
// شغّله بـ: npm run build-data
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const BASE = path.join(__dirname, '..', '..'); // مجلد "تحليل بيانات شركة الاسمنت"

const SOURCES = [
  {
    company: 'Cement',
    companyLabel: 'الاسمنت',
    file: path.join(BASE, 'البيانات_النظيفة_بدون_مشاكل.xlsx'),
    sheet: 'البيانات الصحيحة',
    cols: { name: 'الاسم', job: 'الرقم الوظيفي', national: 'الرقم الوطني/التأميني',
            dob: 'تاريخ الميلاد', card1: 'رقم البطاقة الأول', card2: 'رقم البطاقة الثاني' },
  },
  {
    company: 'Jalyana',
    companyLabel: 'جليانة',
    file: path.join(BASE, 'جليانة_البيانات_النظيفة.xlsx'),
    sheet: 'البيانات الصحيحة',
    cols: { name: 'الاسم', relation: 'صلة القرابة', primary: 'اسم الموظف الأساسي',
            dob: 'تاريخ الميلاد', card1: 'رقم البطاقة الأول', card2: 'رقم البطاقة الثاني',
            status: 'الحالة' },
  },
  {
    company: 'Jamarek',
    companyLabel: 'الجمارك',
    file: path.join(BASE, 'الجمارك_البيانات_النظيفة.xlsx'),
    sheet: 'البيانات الصحيحة',
    cols: { name: 'الاسم', relation: 'صلة القرابة', primary: 'اسم الموظف الأساسي',
            dob: 'تاريخ الميلاد', card1: 'رقم البطاقة الأول', card2: 'رقم البطاقة الثاني',
            status: 'الحالة' },
  },
];

// الاسمنت لا يملك عمود "صلة القرابة" في ملفه؛ الصلة الوحيدة المتاحة هناك مُرمَّزة
// في لاحقة رقم البطاقة نفسها (W=زوجة, H=زوج, بلا لاحقة=موظف أساسي).
const CEMENT_SUFFIX_LABELS = { '': 'موظف أساسي', W: 'زوجة', H: 'زوج' };
function cementRelation(card) {
  const m = String(card || '').match(/^LCC2025\d+([A-Z]+)?\d*$/i);
  const suf = (m && m[1] ? m[1] : '').toUpperCase();
  return CEMENT_SUFFIX_LABELS[suf] || '';
}

function slugForFile(name, card) {
  const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  return `${safe(name)}_${safe(card)}`;
}

const people = [];
let idCounter = 1;

for (const src of SOURCES) {
  if (!fs.existsSync(src.file)) {
    console.warn(`تحذير: الملف غير موجود: ${src.file}`);
    continue;
  }
  const wb = XLSX.readFile(src.file);
  const ws = wb.Sheets[src.sheet];
  if (!ws) {
    console.warn(`تحذير: لا توجد ورقة "${src.sheet}" في ${src.file}`);
    continue;
  }
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  let count = 0;
  for (const row of rows) {
    const name = String(row[src.cols.name] || '').trim();
    if (!name) continue;
    const card1 = String(row[src.cols.card1] || '').trim();
    const card2 = String(row[src.cols.card2] || '').trim();
    const mainCard = card1 || card2;
    people.push({
      id: idCounter++,
      company: src.company,
      companyLabel: src.companyLabel,
      name,
      relation: src.cols.relation ? String(row[src.cols.relation] || '').trim() : (src.company === 'Cement' ? cementRelation(mainCard) : ''),
      primaryName: src.cols.primary ? String(row[src.cols.primary] || '').trim() : '',
      job: src.cols.job ? String(row[src.cols.job] || '').trim() : '',
      national: src.cols.national ? String(row[src.cols.national] || '').trim() : '',
      dob: String(row[src.cols.dob] || '').trim(),
      card1,
      card2,
      status: src.cols.status ? String(row[src.cols.status] || '').trim() : '',
      photoSlug: slugForFile(name, mainCard),
      deleted: false,
    });
    count++;
  }
  console.log(`${src.companyLabel}: ${count} سجل`);
}

const outDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'people.json'), JSON.stringify(people, null, 0), 'utf-8');
console.log(`\n✓ إجمالي: ${people.length} سجل -> data/people.json`);
