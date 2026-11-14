// يطبّق المواليد من الصفوف المظللة بالأصفر في جدول مراجعة (أعمدته: الدفعة، التسلسل، الاسم، المواليد).
// المطابقة في المنظومة: الجهة + الدفعة + التسلسل + الاسم نفسه؛ الصف غير المطابق يُتخطى ويُذكر.
// الاستخدام: node scripts/dob-from-yellow.mjs "<الجدول.xlsx>" [--entity=2] [--apply]
import path from 'node:path';
import { createRequire } from 'node:module';
import { openDb, tx, nowIso, DATA_DIR } from '../lib/db-node.js';
import { normalizeAr, parseDob } from '../lib/derive.js';

const XLSX = createRequire(import.meta.url)('xlsx');
const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
const apply = process.argv.includes('--apply');
const ENTITY = Number(process.argv.find((a) => a.startsWith('--entity='))?.split('=')[1] || 2);
const ACTOR = 'تصحيح المواليد من جدول المراجعة';
if (!file) throw new Error('حدد ملف الجدول');

const wb = XLSX.readFile(file, { cellStyles: true, cellDates: true });
const ws = wb.Sheets[wb.SheetNames[0]];
const range = XLSX.utils.decode_range(ws['!ref']);
const cell = (r, c) => ws[XLSX.utils.encode_cell({ r, c })];
const head = [];
for (let c = 0; c <= range.e.c; c++) head.push(String(cell(0, c)?.v ?? '').trim());
const col = (name) => {
  const i = head.indexOf(name);
  if (i < 0) throw new Error(`عمود «${name}» غير موجود`);
  return i;
};
const [cBatch, cSerial, cName, cDob] = ['الدفعة', 'التسلسل', 'الاسم', 'المواليد'].map(col);
const cRel = head.indexOf('الصلة');

// خلية التاريخ من Excel تُقرأ بمنتصف اليوم حتى لا يرجعها فرق التوقيت يومًا للوراء.
function dobOf(c) {
  if (!c) return '';
  if (c.v instanceof Date) {
    const d = new Date(c.v.getTime() + 12 * 3600e3);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  return parseDob(String(c.v).trim());
}

const db = openDb();
const find = db.prepare('SELECT * FROM beneficiaries WHERE entity_id = ? AND deleted = 0 AND intake_batch = ? AND list_serial = ?');
const fixes = [];
const skipped = [];
let yellow = 0;
for (let r = 1; r <= range.e.r; r++) {
  if (cell(r, 0)?.s?.fgColor?.rgb !== 'FFFF00') continue;
  yellow++;
  const name = String(cell(r, cName)?.v ?? '').trim();
  const dob = dobOf(cell(r, cDob));
  if (!dob) { skipped.push(`${name}: المواليد غير صحيحة «${cell(r, cDob)?.w ?? cell(r, cDob)?.v}»`); continue; }
  const b = find.get(ENTITY, Number(cell(r, cBatch)?.v), Number(cell(r, cSerial)?.v));
  if (!b || normalizeAr(b.name) !== normalizeAr(name)) { skipped.push(`${name}: غير موجود في المنظومة بهذه الدفعة والتسلسل`); continue; }
  // صلة تغيّرت في المنظومة بعد إعداد الجدول = المواليد في الجدول بُنيت على صلة خاطئة؛ تُراجع يدويًا.
  const rel = cRel >= 0 ? String(cell(r, cRel)?.v ?? '').trim() : '';
  const relNow = b.relation === 'موظف أساسي' ? 'موظف' : b.relation;
  if (rel && rel !== relNow) { skipped.push(`${name}: صلته في الجدول «${rel}» وفي المنظومة «${relNow}»؛ راجع مواليده يدويًا`); continue; }
  if ((b.dob || '') === dob) continue;
  fixes.push({ b, dob });
}
console.log(`صفوف صفراء: ${yellow} · سيُصحَّح: ${fixes.length} · متخطى: ${skipped.length}`);
for (const { b, dob } of fixes) console.log(`  ${b.name} (${b.relation}): ${b.dob || 'فارغ'} ← ${dob}`);
for (const s of skipped) console.log(`  تخطٍّ: ${s}`);
if (!apply) {
  console.log('تجربة فقط؛ أضف --apply للتنفيذ.');
  process.exit(0);
}

const backup = path.join(DATA_DIR, `app.before-yellow-dob-${Date.now()}.db`);
db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
console.log(`نسخة احتياطية: ${backup}`);
const at = nowIso();
const upd = db.prepare('UPDATE beneficiaries SET dob = ?, version = version + 1, updated_at = ? WHERE id = ?');
const ev = db.prepare("INSERT INTO beneficiary_events (beneficiary_id, action, field, old_value, new_value, reason, actor, at) VALUES (?, 'edit', 'dob', ?, ?, ?, ?, ?)");
tx(db, () => {
  for (const { b, dob } of fixes) {
    upd.run(dob, at, b.id);
    ev.run(b.id, b.dob || '', dob, 'المواليد من جدول المراجعة (صف أصفر)', ACTOR, at);
  }
});
console.log(`تم تصحيح ${fixes.length} تاريخ ميلاد.`);
