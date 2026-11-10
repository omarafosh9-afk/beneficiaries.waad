// استيراد قائمة مستفيدين لجهة من ملف Excel بالقالب الموحّد. كل ملف = دفعة جديدة للجهة،
// والتسلسل العام يكمل بعد آخر تسلسل فيها. المعاينة لا تكتب شيئًا؛ الحفظ يعيد التحقق كاملًا.
import * as XLSX from 'xlsx';
import { getDb, nowIso } from './db.js';
import { ENTITY_NAMES, normalizeAr, buildSearchKey, parseDob, isPrincipal } from './derive.js';
import { RELATIONS, UserError } from './beneficiaries.js';

export const TEMPLATE_COLUMNS = ['التسلسل', 'الرقم الوظيفي', 'رقم البطاقة', 'الاسم', 'صلة القرابة', 'تاريخ الميلاد', 'الرقم الوطني'];
export const MAX_ROWS = 20000;

const REL = {
  'موظف': 'موظف أساسي', 'الموظف': 'موظف أساسي', 'موظف أساسي': 'موظف أساسي', 'موظف اساسي': 'موظف أساسي',
  'زوجة': 'زوجة', 'الزوجة': 'زوجة', 'زوج': 'زوج', 'الزوج': 'زوج',
  'ابن': 'ابن', 'الابن': 'ابن', 'إبن': 'ابن', 'ابنة': 'ابنة', 'الابنة': 'ابنة', 'بنت': 'ابنة',
  'أب': 'أب', 'اب': 'أب', 'الأب': 'أب', 'الاب': 'أب', 'أم': 'أم', 'ام': 'أم', 'الأم': 'أم', 'الام': 'أم',
};

// رقم البطاقة (مثل JFZ202530482W1) يُستخدم وقت الاستيراد فقط ولا يُخزَّن:
// رقم العائلة بعد السنة، والحرف بعده صلة القرابة (بلا حرف = الموظف).
const CARD_REL = { '': 'موظف أساسي', W: 'زوجة', H: 'زوج', S: 'ابن', D: 'ابنة', F: 'أب', M: 'أم' };
export function cardInfo(card) {
  const m = /^[A-Z]{2,5}20\d{2}(VIP)?(\d+)(?:([WHSDFM])\d*)?$/i.exec(String(card || '').replace(/\s+/g, ''));
  if (!m) return null;
  return { family: (m[1] ? 'VIP' : '') + Number(m[2]), relation: CARD_REL[(m[3] || '').toUpperCase()] };
}

export function templateBuffer() {
  const ws = XLSX.utils.aoa_to_sheet([
    TEMPLATE_COLUMNS,
    [1, '1001', '', 'محمد علي أحمد', 'موظف', '15/03/1980', ''],
    [2, '', '', 'فاطمة سالم محمد', 'زوجة', '1985', ''],
    [3, '', 'ABC202500077', 'سالم محمد سالم', '', '', ''],
    [4, '', 'ABC202500077S1', 'علي سالم محمد', '', '02/09/2010', ''],
  ]);
  ws['!cols'] = [{ wch: 8 }, { wch: 14 }, { wch: 18 }, { wch: 30 }, { wch: 12 }, { wch: 14 }, { wch: 16 }];
  const notes = XLSX.utils.aoa_to_sheet([
    ['تعليمات تعبئة القالب'],
    ['- صف لكل مستفيد. احذف أمثلة الورقة الأولى قبل الرفع.'],
    ['- الاسم وحده إلزامي؛ باقي الأعمدة اختيارية.'],
    ['- الرقم الوظيفي (إن وُجد) يُكتب في صف الموظف؛ أفراد عائلته تحته مباشرة ويُترك لهم فارغًا.'],
    ['- رقم البطاقة (إن وُجد) تُستخلص منه العائلة وصلة القرابة: بلا حرف موظف، W زوجة، H زوج، S ابن، D ابنة، F أب، M أم. لا يُحفظ الرقم نفسه.'],
    ['- صلة القرابة: موظف، زوجة، زوج، ابن، ابنة، أب، أم. إن كُتبت تُقدَّم على رقم البطاقة، وإن غابت مع البطاقة تبقى فارغة للمراجعة.'],
    ['- بلا رقم وظيفي ولا بطاقة: أفراد العائلة يُكتبون تحت الموظف مباشرة.'],
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
  if (col['الاسم'] < 0) throw new UserError('الملف لا يطابق القالب؛ عمود «الاسم» غير موجود.');
  const body = raw.slice(1);
  if (body.length > MAX_ROWS) throw new UserError(`الملف أكبر من ${MAX_ROWS} صف.`);

  const db = await getDb();
  const meta = await db.get(
    'SELECT COALESCE(MAX(intake_batch), 0) + 1 batch, COALESCE(MAX(seq), 0) seq FROM beneficiaries WHERE entity_id = ?', [entity]
  );
  const existing = await db.all(
    'SELECT name, relation, job_no, family_key FROM beneficiaries WHERE entity_id = ? AND deleted = 0', [entity]
  );
  const names = new Set(existing.map((r) => normalizeAr(r.name)));
  const byFamily = new Map();
  const jobFamily = new Map(); // الرقم الوظيفي ← مفتاح عائلته الحالي
  for (const r of existing) {
    if (!byFamily.has(r.family_key)) byFamily.set(r.family_key, []);
    byFamily.get(r.family_key).push(r);
    if (r.job_no && !jobFamily.has(r.job_no)) jobFamily.set(r.job_no, r.family_key);
  }

  const rows = [];
  const errors = [];
  const skipped = [];
  const serials = new Set();
  const heads = new Map(); // مفتاح العائلة ← اسم الموظف في الملف
  let job = '';
  let current = null; // عائلة آخر صف: أفراد بلا رقم وظيفي ولا بطاقة يتبعون الموظف الذي فوقهم
  body.forEach((r, i) => {
    const line = i + 2;
    const get = (c) => (col[c] >= 0 ? cellText(r[col[c]]) : '');
    const name = get('الاسم');
    const jobCell = get('الرقم الوظيفي').replace(/\.0+$/, '');
    const card = cardInfo(get('رقم البطاقة'));
    if (!name && !jobCell) return; // صف فارغ
    if (jobCell) job = jobCell;
    else if (card) job = '';
    const err = (reason) => errors.push({ line, name, reason });
    if (!name) return err('الاسم فارغ.');
    if (name.length > 120) return err('الاسم أطول من 120 حرفًا.');
    if (job && !/^\d{1,10}$/.test(job)) return err(`الرقم الوظيفي ليس أرقامًا: «${job}».`);
    // صلة القرابة اختيارية: من العمود، وإلا من رمز رقم البطاقة، وإلا تبقى فارغة للمراجعة.
    const relIn = get('صلة القرابة');
    const relation = relIn ? REL[relIn] || relIn : card?.relation || '';
    if (relation && !RELATIONS.includes(relation)) return err(`صلة القرابة غير معروفة: «${relIn}».`);
    const dobIn = get('تاريخ الميلاد');
    const dob = parseDob(dobIn);
    if (dob === null) return err(`تاريخ الميلاد غير صحيح: «${dobIn}».`);
    const serialIn = get('التسلسل');
    const serial = serialIn ? Number(serialIn) : null;
    if (serialIn && !(Number.isInteger(serial) && serial > 0)) return err(`التسلسل ليس رقمًا: «${serialIn}».`);
    if (serial && serials.has(serial)) return err(`التسلسل ${serial} مكرر في الملف.`);
    // العائلة: الرقم الوظيفي، ثم رقم العائلة من البطاقة، ثم عائلة الموظف السابق، وإلا عائلة جديدة.
    const family = job ? jobFamily.get(job) || job
      : card ? card.family
      : current && relation && !isPrincipal(relation) ? current
      : `N${meta.batch}-${line}`;
    current = family;
    const key = normalizeAr(name);
    const known = byFamily.get(family) || [];
    // بلا رقم وظيفي ولا بطاقة لا مفتاح للعائلة: التكرار بالاسم في الجهة كلها.
    const loose = !job && !card && names.has(key);
    if (loose || known.some((x) => normalizeAr(x.name) === key) || rows.some((x) => x.family === family && normalizeAr(x.name) === key)) {
      return skipped.push({ line, name, reason: 'موجود مسبقًا بنفس الاسم في العائلة نفسها.' });
    }
    if (isPrincipal(relation)) {
      if (heads.has(family) || known.some((x) => isPrincipal(x.relation))) return err('لهذه العائلة موظف آخر.');
      heads.set(family, name);
    }
    if (serial) serials.add(serial);
    rows.push({ line, serial, job, family, name, relation, dob, national: get('الرقم الوطني') });
  });
  // الصفوف بلا تسلسل تأخذ رقمًا بعد أكبر تسلسل في الملف.
  let next = Math.max(0, ...serials);
  for (const r of rows) if (!r.serial) r.serial = ++next;

  return { entity, rows, byFamily, heads, errors: errors.sort((a, b) => a.line - b.line), skipped, batch: meta.batch, lastSeq: meta.seq };
}

export async function previewImport(entityId, bytes) {
  const a = await analyze(entityId, bytes);
  return {
    entity: ENTITY_NAMES[a.entity],
    batch: a.batch,
    count: a.rows.length,
    firstSeq: a.lastSeq + 1,
    lastSeq: a.lastSeq + a.rows.length,
    families: new Set(a.rows.map((r) => r.family)).size,
    errors: a.errors.slice(0, 200),
    errorCount: a.errors.length,
    skipped: a.skipped.slice(0, 200),
    skippedCount: a.skipped.length,
    sample: a.rows.slice(0, 8).map(({ serial, job, name, relation, dob }) => ({ serial, job, name, relation: relation || '—', dob })),
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
    const row = {
      family_key: r.family,
      job_no: r.job || null,
      employee_name: a.heads.get(r.family) || (a.byFamily.get(r.family) || []).find((x) => isPrincipal(x.relation))?.name || null,
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
