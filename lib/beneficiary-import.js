// استيراد قائمة مستفيدين لجهة من ملف Excel بالقالب الموحّد. كل ملف = دفعة جديدة للجهة،
// والتسلسل العام يكمل بعد آخر تسلسل فيها. المعاينة لا تكتب شيئًا؛ الحفظ يعيد التحقق كاملًا.
import * as XLSX from 'xlsx';
import { getDb, nowIso } from './db.js';
import { ENTITY_NAMES, normalizeAr, buildSearchKey, parseDob, isPrincipal } from './derive.js';
import { RELATIONS, UserError } from './beneficiaries.js';

export const TEMPLATE_COLUMNS = ['التسلسل', 'الرقم الوظيفي', 'الاسم', 'صلة القرابة', 'تاريخ الميلاد', 'الرقم الوطني'];
export const MAX_ROWS = 20000;

const REL = {
  'موظف': 'موظف أساسي', 'الموظف': 'موظف أساسي', 'موظف أساسي': 'موظف أساسي', 'موظف اساسي': 'موظف أساسي',
  'زوجة': 'زوجة', 'الزوجة': 'زوجة', 'زوج': 'زوج', 'الزوج': 'زوج',
  'ابن': 'ابن', 'الابن': 'ابن', 'إبن': 'ابن', 'ابنة': 'ابنة', 'الابنة': 'ابنة', 'بنت': 'ابنة',
  'أب': 'أب', 'اب': 'أب', 'الأب': 'أب', 'الاب': 'أب', 'أم': 'أم', 'ام': 'أم', 'الأم': 'أم', 'الام': 'أم',
};

export function templateBuffer() {
  const ws = XLSX.utils.aoa_to_sheet([
    TEMPLATE_COLUMNS,
    [1, '1001', 'محمد علي أحمد', 'موظف', '15/03/1980', ''],
    [2, '', 'فاطمة سالم محمد', 'زوجة', '1985', ''],
    [3, '', 'أحمد محمد علي', 'ابن', '02/09/2010', ''],
  ]);
  ws['!cols'] = [{ wch: 8 }, { wch: 14 }, { wch: 30 }, { wch: 12 }, { wch: 14 }, { wch: 16 }];
  const notes = XLSX.utils.aoa_to_sheet([
    ['تعليمات تعبئة القالب'],
    ['- صف لكل مستفيد. احذف أمثلة الورقة الأولى قبل الرفع.'],
    ['- الرقم الوظيفي يُكتب في صف الموظف؛ أفراد عائلته تحته مباشرة ويُترك لهم فارغًا (أو يُكرر).'],
    ['- صلة القرابة: موظف، زوجة، زوج، ابن، ابنة، أب، أم.'],
    ['- تاريخ الميلاد: يوم/شهر/سنة مثل 15/03/1980، أو السنة وحدها، أو فارغ.'],
    ['- التسلسل: رقمه في القائمة (مفتاح ربط الصور). إن تُرك فارغًا يُرقّم بترتيب الصفوف.'],
    ['- كل ملف يُستورد كدفعة جديدة للجهة.'],
  ]);
  notes['!cols'] = [{ wch: 90 }];
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, 'المستفيدون');
  XLSX.utils.book_append_sheet(wb, notes, 'تعليمات');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function cellText(v) {
  if (v instanceof Date) {
    const d = new Date(v.getTime() - v.getTimezoneOffset() * 60000);
    return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
  }
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

// يقرأ الملف ويتحقق من كل صف. الأعمدة تُعرف بعناوينها (بأي ترتيب).
async function analyze(entityId, bytes) {
  const entity = Number(entityId);
  if (!ENTITY_NAMES[entity]) throw new UserError('اختر الجهة.');
  let wb;
  try {
    wb = XLSX.read(bytes, { type: 'buffer', cellDates: true });
  } catch {
    throw new UserError('تعذّرت قراءة الملف؛ ارفع ملف Excel بصيغة xlsx.');
  }
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const head = (raw[0] || []).map((h) => normalizeAr(h));
  const col = Object.fromEntries(TEMPLATE_COLUMNS.map((c) => [c, head.indexOf(normalizeAr(c))]));
  const missing = ['الاسم', 'صلة القرابة', 'الرقم الوظيفي'].filter((c) => col[c] < 0);
  if (missing.length) throw new UserError(`الملف لا يطابق القالب؛ الأعمدة الناقصة: ${missing.join('، ')}.`);
  const body = raw.slice(1);
  if (body.length > MAX_ROWS) throw new UserError(`الملف أكبر من ${MAX_ROWS} صف.`);

  const db = await getDb();
  const existing = await db.all(
    'SELECT name, relation, job_no, family_key FROM beneficiaries WHERE entity_id = ? AND deleted = 0', [entity]
  );
  const byJob = new Map();
  for (const r of existing) {
    if (!r.job_no) continue;
    if (!byJob.has(r.job_no)) byJob.set(r.job_no, []);
    byJob.get(r.job_no).push(r);
  }

  const rows = [];
  const errors = [];
  const skipped = [];
  const serials = new Set();
  const heads = new Map(); // الرقم الوظيفي ← اسم الموظف في الملف
  let job = '';
  body.forEach((r, i) => {
    const line = i + 2;
    const get = (c) => (col[c] >= 0 ? cellText(r[col[c]]) : '');
    const name = get('الاسم');
    const jobCell = get('الرقم الوظيفي').replace(/\.0+$/, '');
    if (!name && !jobCell) return; // صف فارغ
    if (jobCell) job = jobCell;
    const err = (reason) => errors.push({ line, name, reason });
    if (!name) return err('الاسم فارغ.');
    if (name.length > 120) return err('الاسم أطول من 120 حرفًا.');
    if (!/^\d{1,10}$/.test(job)) return err('الرقم الوظيفي مفقود أو ليس أرقامًا.');
    const relation = REL[get('صلة القرابة')] || get('صلة القرابة');
    if (!RELATIONS.includes(relation)) return err(`صلة القرابة غير معروفة: «${get('صلة القرابة') || 'فارغ'}».`);
    const dobIn = get('تاريخ الميلاد');
    const dob = parseDob(dobIn);
    if (dob === null) return err(`تاريخ الميلاد غير صحيح: «${dobIn}».`);
    const serialIn = get('التسلسل');
    const serial = serialIn ? Number(serialIn) : null;
    if (serialIn && !(Number.isInteger(serial) && serial > 0)) return err(`التسلسل ليس رقمًا: «${serialIn}».`);
    if (serial && serials.has(serial)) return err(`التسلسل ${serial} مكرر في الملف.`);
    const family = byJob.get(job) || [];
    const key = normalizeAr(name);
    if (family.some((x) => normalizeAr(x.name) === key) || rows.some((x) => x.job === job && normalizeAr(x.name) === key)) {
      return skipped.push({ line, name, reason: 'موجود مسبقًا بنفس الاسم والرقم الوظيفي.' });
    }
    if (isPrincipal(relation)) {
      if (heads.has(job) || family.some((x) => isPrincipal(x.relation))) return err(`للرقم الوظيفي ${job} موظف آخر.`);
      heads.set(job, name);
    }
    if (serial) serials.add(serial);
    rows.push({ line, serial, job, name, relation, dob, national: get('الرقم الوطني') });
  });
  // أفراد بلا موظف في الملف ولا في المنظومة.
  for (const r of rows) {
    if (!isPrincipal(r.relation) && !heads.has(r.job) && !(byJob.get(r.job) || []).length) {
      errors.push({ line: r.line, name: r.name, reason: `لا يوجد موظف بالرقم الوظيفي ${r.job}.` });
      r.bad = true;
    }
  }
  const good = rows.filter((r) => !r.bad);
  // الصفوف بلا تسلسل تأخذ رقمًا بعد أكبر تسلسل في الملف.
  let next = Math.max(0, ...serials);
  for (const r of good) if (!r.serial) r.serial = ++next;

  const meta = await db.get(
    'SELECT COALESCE(MAX(intake_batch), 0) + 1 batch, COALESCE(MAX(seq), 0) seq FROM beneficiaries WHERE entity_id = ?', [entity]
  );
  return { entity, rows: good, byJob, heads, errors: errors.sort((a, b) => a.line - b.line), skipped, batch: meta.batch, lastSeq: meta.seq };
}

export async function previewImport(entityId, bytes) {
  const a = await analyze(entityId, bytes);
  return {
    entity: ENTITY_NAMES[a.entity],
    batch: a.batch,
    count: a.rows.length,
    firstSeq: a.lastSeq + 1,
    lastSeq: a.lastSeq + a.rows.length,
    families: new Set(a.rows.map((r) => r.job)).size,
    errors: a.errors.slice(0, 200),
    errorCount: a.errors.length,
    skipped: a.skipped.slice(0, 200),
    skippedCount: a.skipped.length,
    sample: a.rows.slice(0, 8).map(({ serial, job, name, relation, dob }) => ({ serial, job, name, relation, dob })),
  };
}

export async function applyImport(entityId, bytes, actor) {
  const a = await analyze(entityId, bytes);
  if (!a.rows.length) throw new UserError('لا توجد صفوف صالحة للاستيراد.');
  const db = await getDb();
  const at = nowIso();
  const reason = `استيراد الدفعة ${a.batch}`;
  const stmts = [];
  a.rows.forEach((r, i) => {
    const family = a.byJob.get(r.job) || [];
    const row = {
      family_key: family[0]?.family_key || r.job,
      job_no: r.job,
      employee_name: a.heads.get(r.job) || family.find((x) => isPrincipal(x.relation))?.name || null,
      name: r.name,
      relation: r.relation,
      dob: r.dob || null,
      national_id: r.national || null,
    };
    stmts.push([
      `INSERT INTO beneficiaries (entity_id, family_key, job_no, employee_name, name, relation, dob, national_id,
         intake_batch, list_serial, seq, legacy_status, search_key, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'نشط', ?, ?)`,
      [a.entity, row.family_key, row.job_no, row.employee_name, row.name, row.relation, row.dob, row.national_id,
        a.batch, r.serial, a.lastSeq + i + 1, buildSearchKey(row), at],
    ]);
    stmts.push([
      `INSERT INTO beneficiary_events (beneficiary_id, action, reason, actor, at) VALUES (last_insert_rowid(), 'add', ?, ?, ?)`,
      [reason, actor, at],
    ]);
  });
  await db.batch(stmts);
  return { entity: ENTITY_NAMES[a.entity], batch: a.batch, added: a.rows.length, errorCount: a.errors.length, skippedCount: a.skipped.length };
}
