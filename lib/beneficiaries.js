// كل القراءة والكتابة على جدول المستفيدين: شاشة جهة العمل، شاشة الشركة (TPA)،
// ومحوّل للشاشة القديمة (البحث/الإضافة/الاستيراد) يحافظ على شكل بياناتها السابق.
// كل الدوال async لتعمل على SQLite المحلية وعلى D1 (Cloudflare) بنفس الكود.
import path from 'node:path';
import { getDb, nowIso, inList, onCloudflare } from './db.js';
import { STORAGE_DIR } from './photos.js';
import { genderMismatches, forgetGender } from './gender.js';
import {
  ENTITY_CODES, ENTITY_NAMES, ENTITY_IDS, normalizeAr, buildSearchKey, deriveRows, relationRank, isPrincipal,
} from './derive.js';

export const STATUSES = ['pending', 'needs_edit', 'correct', 'modified', 'forwarded', 'printed', 'delivered'];
export const LOCKED = new Set(['forwarded', 'printed', 'delivered']);
export const RELATIONS = ['موظف أساسي', 'زوجة', 'زوج', 'ابن', 'ابنة', 'أب', 'أم'];
export const FAMILIES_PER_PAGE = 20;
export const ROWS_PER_PAGE = 50;

const COMPLETE_SQL = "(b.photo_file IS NOT NULL AND b.dob IS NOT NULL AND b.dob <> '')";

// يبني شرط WHERE من الفلاتر. tab=ready (لـ TPA): صحيح/معدل ومكتمل.
export function buildWhere(f, { withTab = true } = {}) {
  // تبويب «محذوف» (لـ TPA فقط) يعرض المحذوفين حذفًا ناعمًا؛ كل ما عداه يستبعدهم.
  const deletedView = withTab && f.tab === 'deleted';
  const parts = [deletedView ? 'b.deleted = 1' : 'b.deleted = 0'];
  const params = [];
  if (f.entityId) { parts.push('b.entity_id = ?'); params.push(f.entityId); }
  if (f.relation) { parts.push('b.relation = ?'); params.push(f.relation); }
  if (f.completeness === 'complete') parts.push(COMPLETE_SQL);
  if (f.completeness === 'missing') parts.push(`NOT ${COMPLETE_SQL}`);
  if (f.completeness === 'no_photo') parts.push('b.photo_file IS NULL');
  if (f.completeness === 'no_dob') parts.push("(b.dob IS NULL OR b.dob = '')");
  // خلط الجنس في الصلة: المعرّفات محسوبة مسبقًا في withGender.
  if (f.completeness === 'gender') { parts.push('b.id IN (SELECT value FROM json_each(?))'); params.push(JSON.stringify(f._genderIds || [])); }
  if (f.completeness === 'no_employee') parts.push("(b.employee_name IS NULL OR b.employee_name = '' OR b.job_no IS NULL OR b.job_no = '')");
  if (f.intake) { parts.push('b.intake_batch = ?'); params.push(Number(f.intake)); }
  // حالة المستفيد لدى الجهة: نشط / موقوف / مكتمل (المخزّنة في legacy_status).
  if (f.benStatus) { parts.push("COALESCE(NULLIF(b.legacy_status, ''), 'نشط') = ?"); params.push(f.benStatus); }
  const q = normalizeAr(f.q);
  if (q) { parts.push('b.search_key LIKE ?'); params.push(`%${q}%`); }
  if (withTab && f.tab && f.tab !== 'all' && !deletedView) {
    if (f.tab === 'ready') parts.push(`b.review_status IN ('correct','modified') AND ${COMPLETE_SQL}`);
    else { parts.push('b.review_status = ?'); params.push(f.tab); }
  }
  return { sql: parts.join(' AND '), params };
}

export function photoUrl(entityId, file) {
  return file ? `/photos/${ENTITY_CODES[entityId]}/${encodeURIComponent(file)}` : null;
}

async function prevValues(db, ids) {
  const out = {};
  if (!ids.length) return out;
  const [cond, p] = inList('beneficiary_id', ids);
  const rows = await db.all(
    `SELECT beneficiary_id, field, old_value FROM beneficiary_events WHERE action = 'edit' AND ${cond} ORDER BY id`, [p]
  );
  for (const r of rows) {
    out[r.beneficiary_id] ??= {};
    if (!(r.field in out[r.beneficiary_id])) out[r.beneficiary_id][r.field] = r.old_value;
  }
  return out;
}

function toView(r, prev) {
  return {
    id: r.id,
    entityId: r.entity_id,
    entity: ENTITY_NAMES[r.entity_id],
    familyKey: r.family_key,
    jobNo: r.job_no,
    listBatch: r.intake_batch || null,
    serial: r.list_serial ?? null,
    seq: r.seq ?? null,
    employeeName: r.employee_name,
    name: r.name,
    relation: r.relation,
    dob: r.dob || '',
    // جليانة: رقم البطاقة يظهر فارغًا (تُصدر لها بطاقات جديدة)؛ القيمة القديمة تبقى محفوظة في القاعدة.
    card: r.entity_id === 2 ? '' : r.card1 || r.card2 || '',
    photoUrl: photoUrl(r.entity_id, r.photo_file),
    status: r.review_status,
    benStatus: r.legacy_status || 'نشط',
    note: r.review_note || '',
    reason: r.modified_reason || '',
    batch: r.print_batch_id,
    version: r.version,
    deleted: !!r.deleted,
    prev: prev?.[r.id] || {},
  };
}

function sortMembers(list) {
  return list.sort((a, b) => relationRank(a.relation) - relationRank(b.relation) || (a.seq ?? Infinity) - (b.seq ?? Infinity) || a.id - b.id);
}

// الفرز: serial (افتراضي: الدفعة ثم التسلسل كما في قوائم الجهة) | job | name | employee، والاتجاه asc | desc.
const JOB_SQL = "CAST(COALESCE(NULLIF(b.job_no, ''), b.family_key) AS INTEGER)";
function orderSql(f, grouped) {
  const dir = f.dir === 'desc' ? 'DESC' : 'ASC';
  if (grouped) {
    if (f.sort === 'name' || f.sort === 'employee') return `MIN(COALESCE(NULLIF(b.employee_name, ''), b.name)) ${dir}, b.family_key`;
    if (f.sort === 'serial') return `MIN(b.seq) IS NULL, MIN(b.seq) ${dir}, MIN(${JOB_SQL}), b.family_key`;
    return `MIN(${JOB_SQL}) ${dir}, b.family_key`;
  }
  if (f.sort === 'serial') return `b.seq IS NULL, b.seq ${dir}, ${JOB_SQL}, b.family_key, b.id`;
  if (f.sort === 'name') return `b.search_key ${dir}, b.id`;
  if (f.sort === 'employee') return `COALESCE(b.employee_name, '') ${dir}, ${JOB_SQL}, b.id`;
  return `${JOB_SQL} ${dir}, b.family_key, b.id`;
}

// فلتر «خلط الجنس» يحتاج حسابًا مسبقًا (async) قبل بناء جملة SQL.
async function withGender(f) {
  if (f?.completeness !== 'gender' || f._genderIds) return f;
  return { ...f, _genderIds: [...(await genderMismatches()).keys()] };
}

// في فلتر «خلط الجنس» يُرفق بكل سجل الصلة المقترحة.
async function attachSuggest(f, views) {
  if (f.completeness !== 'gender') return views;
  const map = await genderMismatches();
  for (const v of views) v.suggestRel = map.get(v.id) || null;
  return views;
}

export async function listBeneficiaries(f) {
  f = await withGender(f);
  const db = await getDb();
  const page = Math.max(1, Number(f.page) || 1);
  const base = buildWhere(f, { withTab: false });
  const counts = { all: 0 };
  for (const s of STATUSES) counts[s] = 0;
  for (const r of await db.all(`SELECT b.review_status s, COUNT(*) n FROM beneficiaries b WHERE ${base.sql} GROUP BY s`, base.params)) {
    counts[r.s] = r.n;
    counts.all += r.n;
  }
  if (f.withDeleted) {
    const del = buildWhere({ ...f, tab: 'deleted' });
    counts.deleted = (await db.get(`SELECT COUNT(*) n FROM beneficiaries b WHERE ${del.sql}`, del.params)).n;
  }
  counts.ready = (await db.get(`SELECT COUNT(*) n FROM beneficiaries b WHERE ${base.sql} AND b.review_status IN ('correct','modified') AND ${COMPLETE_SQL}`, base.params)).n;

  const scope = buildWhere({ entityId: f.entityId });
  const prog = await db.get(
    `SELECT COUNT(*) total, SUM(CASE WHEN b.review_status NOT IN ('pending','needs_edit') THEN 1 ELSE 0 END) done
     FROM beneficiaries b WHERE ${scope.sql}`, scope.params
  );
  const progress = { done: prog.done || 0, total: prog.total };

  const w = buildWhere(f);
  if (f.grouped) {
    const total = (await db.get(`SELECT COUNT(DISTINCT b.entity_id || '|' || b.family_key) n FROM beneficiaries b WHERE ${w.sql}`, w.params)).n;
    const totalPages = Math.max(1, Math.ceil(total / FAMILIES_PER_PAGE));
    const fams = await db.all(
      `SELECT b.entity_id e, b.family_key k FROM beneficiaries b WHERE ${w.sql}
       GROUP BY b.entity_id, b.family_key
       ORDER BY ${orderSql(f, true)} LIMIT ? OFFSET ?`,
      [...w.params, FAMILIES_PER_PAGE, (page - 1) * FAMILIES_PER_PAGE]
    );
    let rows = [];
    if (fams.length) {
      const [cond, p] = inList("(b.entity_id || '|' || b.family_key)", fams.map((x) => x.e + '|' + x.k));
      rows = await db.all(`SELECT b.* FROM beneficiaries b WHERE ${w.sql} AND ${cond}`, [...w.params, p]);
    }
    const prev = await prevValues(db, rows.map((r) => r.id));
    const byKey = new Map(fams.map((x) => [x.e + '|' + x.k, []]));
    for (const r of rows) byKey.get(r.entity_id + '|' + r.family_key)?.push(toView(r, prev));
    await attachSuggest(f, [...byKey.values()].flat());
    const families = fams.map((x) => {
      const members = sortMembers(byKey.get(x.e + '|' + x.k));
      const principal = members.find((m) => isPrincipal(m.relation));
      return {
        key: x.e + '|' + x.k,
        entityId: x.e,
        entity: ENTITY_NAMES[x.e],
        familyKey: x.k,
        jobNo: members.find((m) => m.jobNo)?.jobNo || '',
        listBatch: members.find((m) => m.listBatch)?.listBatch || null,
        employeeName: principal?.name || members.find((m) => m.employeeName)?.employeeName || '',
        members,
      };
    });
    return { counts, progress, page, totalPages, total, families };
  }
  const total = (await db.get(`SELECT COUNT(*) n FROM beneficiaries b WHERE ${w.sql}`, w.params)).n;
  const totalPages = Math.max(1, Math.ceil(total / ROWS_PER_PAGE));
  const rows = await db.all(
    `SELECT b.* FROM beneficiaries b WHERE ${w.sql} ORDER BY ${orderSql(f, false)} LIMIT ? OFFSET ?`,
    [...w.params, ROWS_PER_PAGE, (page - 1) * ROWS_PER_PAGE]
  );
  const prev = await prevValues(db, rows.map((r) => r.id));
  return { counts, progress, page, totalPages, total, rows: await attachSuggest(f, rows.map((r) => toView(r, prev))) };
}

export async function exportRows(f) {
  f = await withGender(f);
  const db = await getDb();
  const w = buildWhere(f);
  return (await db.all(`SELECT b.* FROM beneficiaries b WHERE ${w.sql} ORDER BY ${orderSql(f, false)}`, w.params)).map((r) => toView(r));
}

// الهدف: { ids: [...] } أو { filter: {...} }. scopeEntityId يحصر العملية في جهة المستخدم.
async function resolveFull(db, target, scopeEntityId) {
  let rows;
  if (target?.filter) {
    // الاعتماد والترحيل الجماعي لا يشملان المحذوفات أبدًا.
    if (target.filter.tab === 'deleted') return [];
    const w = buildWhere(await withGender({ ...target.filter, entityId: scopeEntityId || target.filter.entityId }));
    rows = await db.all(`SELECT b.* FROM beneficiaries b WHERE ${w.sql}`, w.params);
  } else {
    const ids = (target?.ids || []).map(Number).filter(Number.isInteger);
    if (!ids.length) return [];
    const [cond, p] = inList('b.id', ids);
    rows = await db.all(`SELECT b.* FROM beneficiaries b WHERE b.deleted = 0 AND ${cond}`, [p]);
  }
  return scopeEntityId ? rows.filter((r) => r.entity_id === scopeEntityId) : rows;
}

// النواقص التي تمنع الاعتماد: الصورة والمواليد.
export function missingOf(r) {
  const m = [];
  if (!r.photo_file) m.push('الصورة');
  if (!r.dob) m.push('المواليد');
  return m;
}

// تقسيم الهدف: ما يُعتمد (بانتظار التحقق ومكتمل)، وما ينقصه بيانات، وما يحتاج تعديل، والباقي بلا تغيير.
function classify(rows) {
  const pending = rows.filter((r) => r.review_status === 'pending');
  const ok = pending.filter((r) => !missingOf(r).length);
  const incomplete = pending.filter((r) => missingOf(r).length);
  const needs = rows.filter((r) => r.review_status === 'needs_edit').length;
  return { ok, incomplete, needs, same: rows.length - pending.length - needs };
}

function summary(c) {
  return {
    needs: c.needs,
    same: c.same,
    incompleteCount: c.incomplete.length,
    incomplete: c.incomplete.slice(0, 50).map((r) => ({ id: r.id, name: r.name, missing: missingOf(r) })),
  };
}

export async function previewApproval(target, scopeEntityId) {
  const c = classify(await resolveFull(await getDb(), target, scopeEntityId));
  return { approve: c.ok.length, ...summary(c) };
}

export async function approve(target, actor, scopeEntityId) {
  const db = await getDb();
  const c = classify(await resolveFull(db, target, scopeEntityId));
  if (c.ok.length) {
    const at = nowIso();
    const [cond, p] = inList('id', c.ok.map((r) => r.id));
    await db.batch([
      [`INSERT INTO beneficiary_events (beneficiary_id, action, actor, at)
        SELECT id, 'approve', ?, ? FROM beneficiaries WHERE review_status = 'pending' AND ${cond}`, [actor, at, p]],
      [`UPDATE beneficiaries SET review_status = 'correct', version = version + 1, updated_at = ? WHERE review_status = 'pending' AND ${cond}`, [at, p]],
    ]);
  }
  return { approved: c.ok.length, ...summary(c) };
}

export class UserError extends Error {}

export async function getBeneficiary(id) {
  return (await getDb()).get('SELECT * FROM beneficiaries WHERE id = ?', [Number(id)]);
}

// تغيير الرقم الوظيفي إلى رقم عائلة أخرى = ضمّ العائلتين. يعيد ما يلزم تأكيده (أو null إن لا ضمّ):
// أفراد العائلة الأخرى، والأسماء المكررة بينهما، ووجود موظفَين.
export async function jobMergeInfo(b, jobNo) {
  const job = String(jobNo ?? '').trim();
  if (!job || job === (b.job_no || '')) return null;
  const db = await getDb();
  const other = await db.all(
    'SELECT * FROM beneficiaries WHERE entity_id = ? AND deleted = 0 AND job_no = ? AND family_key <> ?', [b.entity_id, job, b.family_key]
  );
  if (!other.length) return null;
  const mine = await db.all('SELECT * FROM beneficiaries WHERE entity_id = ? AND deleted = 0 AND family_key = ?', [b.entity_id, b.family_key]);
  const names = new Set(other.map((r) => normalizeAr(r.name)));
  return {
    job,
    familyKey: other[0].family_key,
    members: other.map((r) => ({ name: r.name, relation: r.relation })),
    moving: mine.map((r) => ({ name: r.name, relation: r.relation })),
    duplicates: mine.filter((r) => names.has(normalizeAr(r.name))).map((r) => r.name),
    twoEmployees: other.some((r) => isPrincipal(r.relation)) && mine.some((r) => isPrincipal(r.relation)),
  };
}

// تعديل جهة العمل: سبب إلزامي وتغيير فعلي؛ يصبح السجل «معدل».
export async function editBeneficiary({ id, version, name, jobNo, relation, dob, reason, photoFile, confirmMerge }, actor, scopeEntityId) {
  const db = await getDb();
  const b = await db.get('SELECT * FROM beneficiaries WHERE id = ? AND deleted = 0', [Number(id)]);
  if (!b || (scopeEntityId && b.entity_id !== scopeEntityId)) throw new UserError('السجل غير موجود.');
  if (LOCKED.has(b.review_status)) throw new UserError('السجل مقفل بعد الترحيل ولا يمكن تعديله.');
  if (Number(version) !== b.version) throw new UserError('عُدّل هذا السجل للتو من مكان آخر؛ حدّث الصفحة.');
  const next = { name: String(name ?? '').replace(/\s+/g, ' ').trim(), relation, dob: dob || null };
  if (!next.name || next.name.length > 120) throw new UserError('الاسم مطلوب وبحد أقصى 120 حرفًا.');
  if (!RELATIONS.includes(next.relation)) throw new UserError('صلة القرابة غير صحيحة.');
  const changed = ['name', 'relation', 'dob'].filter((k) => (next[k] || '') !== (b[k] || ''));
  // الرقم الوظيفي للعائلة كلها: يتغير لكل أفرادها. إن كان لعائلة أخرى تُضمّ العائلتان بعد تأكيد صريح.
  const job = jobNo === undefined || jobNo === null ? b.job_no || '' : String(jobNo).trim();
  const jobChanged = job !== (b.job_no || '');
  let merge = null;
  if (jobChanged) {
    if (!/^\d{1,10}$/.test(job)) throw new UserError('الرقم الوظيفي أرقام فقط (حتى 10 أرقام).');
    merge = await jobMergeInfo(b, job);
    if (merge && !confirmMerge) throw new UserError(`الرقم الوظيفي ${job} لعائلة أخرى؛ أكّد الضمّ أولًا.`);
  }
  if (!changed.length && !jobChanged && !photoFile) throw new UserError('لم يتغيّر شيء في البيانات.');
  const why = String(reason ?? '').trim();
  if (!why) throw new UserError('اكتب سبب التعديل قبل الحفظ.');
  if (why.length > 300) throw new UserError('سبب التعديل أطول من 300 حرف.');
  const at = nowIso();
  const merged = { ...b, ...next, photo_file: photoFile || b.photo_file };
  const ev = `INSERT INTO beneficiary_events (beneficiary_id, action, field, old_value, new_value, reason, actor, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  const stmts = changed.map((k) => [ev, [b.id, 'edit', k, b[k] || '', next[k] || '', why, actor, at]]);
  if (photoFile) stmts.push([ev, [b.id, 'photo', 'photo_file', b.photo_file || '', photoFile, why, actor, at]]);
  if (jobChanged) {
    const family = await db.all('SELECT * FROM beneficiaries WHERE entity_id = ? AND deleted = 0 AND family_key = ?', [b.entity_id, b.family_key]);
    // عند الضمّ: مفتاح العائلة الأخرى، واسم الموظف من موظفها (وإلا موظف العائلة المنقولة).
    const key = merge ? merge.familyKey : b.family_key;
    let employee = null;
    if (merge) {
      const heads = await db.all(
        'SELECT name FROM beneficiaries WHERE entity_id = ? AND deleted = 0 AND family_key IN (?, ?) AND relation = ?', [b.entity_id, key, b.family_key, 'موظف أساسي']
      );
      employee = heads[0]?.name || null;
      const others = await db.all('SELECT * FROM beneficiaries WHERE entity_id = ? AND deleted = 0 AND family_key = ?', [b.entity_id, key]);
      for (const o of others) {
        if (employee && o.employee_name !== employee) {
          stmts.push(['UPDATE beneficiaries SET employee_name = ?, search_key = ?, updated_at = ? WHERE id = ?', [employee, buildSearchKey({ ...o, employee_name: employee }), at, o.id]]);
        }
      }
    }
    for (const f of family) {
      const emp = merge ? employee || f.employee_name : f.employee_name;
      stmts.push([ev, [f.id, 'edit', 'job_no', f.job_no || '', job, why, actor, at]]);
      if (merge) stmts.push([ev, [f.id, 'merge', 'family_key', f.family_key, key, why, actor, at]]);
      stmts.push([
        'UPDATE beneficiaries SET job_no = ?, family_key = ?, employee_name = ?, search_key = ?, version = version + 1, updated_at = ? WHERE id = ?',
        [job, key, emp, buildSearchKey({ ...f, job_no: job, employee_name: emp }), at, f.id],
      ]);
    }
    Object.assign(merged, { job_no: job, family_key: key, employee_name: merge ? employee || b.employee_name : b.employee_name });
  }
  stmts.push([
    `UPDATE beneficiaries SET name = ?, relation = ?, dob = ?, photo_file = ?, review_status = 'modified', review_note = NULL,
     modified_reason = ?, search_key = ?, version = version + 1, updated_at = ? WHERE id = ?`,
    [merged.name, merged.relation, merged.dob, merged.photo_file, why, buildSearchKey(merged), at, b.id],
  ]);
  await db.batch(stmts);
  if (changed.includes('relation') || changed.includes('name')) forgetGender();
  return toView(await db.get('SELECT * FROM beneficiaries WHERE id = ?', [b.id]));
}

// إضافة مستفيد جديد: يأخذ التسلسل العام التالي لآخر تسلسل في جهته (يُحسب داخل جملة الإدخال نفسها).
export async function addBeneficiary({ entityId, jobNo, name, relation, dob, photoFile }, actor) {
  const db = await getDb();
  const entity = Number(entityId);
  if (!ENTITY_NAMES[entity]) throw new UserError('اختر جهة العمل.');
  const job = String(jobNo ?? '').trim();
  if (!/^\d{1,10}$/.test(job)) throw new UserError('الرقم الوظيفي مطلوب (أرقام فقط).');
  const clean = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!clean || clean.length > 120) throw new UserError('الاسم مطلوب وبحد أقصى 120 حرفًا.');
  if (!RELATIONS.includes(relation)) throw new UserError('صلة القرابة غير صحيحة.');
  const family = await db.all('SELECT name, relation, employee_name, family_key FROM beneficiaries WHERE entity_id = ? AND deleted = 0 AND job_no = ?', [entity, job]);
  const head = family.find((r) => isPrincipal(r.relation));
  if (isPrincipal(relation) && head) throw new UserError(`لهذا الرقم الوظيفي موظف مسجّل: ${head.name}.`);
  if (!isPrincipal(relation) && !family.length) throw new UserError('لا توجد عائلة بهذا الرقم الوظيفي؛ أضف الموظف أولًا.');
  const row = {
    family_key: family[0]?.family_key || job,
    job_no: job,
    employee_name: isPrincipal(relation) ? clean : head?.name || family.find((r) => r.employee_name)?.employee_name || null,
    name: clean,
    relation,
    dob: dob || null,
  };
  const at = nowIso();
  const { lastRowId } = await db.run(
    `INSERT INTO beneficiaries (entity_id, family_key, job_no, employee_name, name, relation, dob, photo_file, seq, legacy_status, search_key, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(MAX(seq), 0) + 1, 'نشط', ?, ? FROM beneficiaries WHERE entity_id = ?`,
    [entity, row.family_key, row.job_no, row.employee_name, row.name, row.relation, row.dob, photoFile || null, buildSearchKey(row), at, entity]
  );
  await db.run(`INSERT INTO beneficiary_events (beneficiary_id, action, reason, actor, at) VALUES (?, 'add', 'إضافة مستفيد جديد', ?, ?)`, [lastRowId, actor, at]);
  return toView(await db.get('SELECT * FROM beneficiaries WHERE id = ?', [lastRowId]));
}

// تصحيح جماعي لصلة القرابة المخالفة لجنس الاسم (ابنة→ابن ...). المرحَّل لا يُعدَّل. يصبح السجل «معدل».
export async function previewFixRelations(target, scopeEntityId) {
  const map = await genderMismatches({ fresh: true });
  const rows = (await resolveFull(await getDb(), target, scopeEntityId)).filter((r) => map.has(r.id));
  return { fix: rows.filter((r) => !LOCKED.has(r.review_status)).length, locked: rows.filter((r) => LOCKED.has(r.review_status)).length };
}

export async function fixRelations(target, actor, scopeEntityId) {
  const db = await getDb();
  const map = await genderMismatches({ fresh: true });
  const rows = (await resolveFull(db, target, scopeEntityId)).filter((r) => map.has(r.id) && !LOCKED.has(r.review_status));
  const at = nowIso();
  const why = 'تصحيح جماعي: صلة القرابة تخالف جنس الاسم';
  const stmts = [];
  for (const r of rows) {
    const rel = map.get(r.id);
    stmts.push([`INSERT INTO beneficiary_events (beneficiary_id, action, field, old_value, new_value, reason, actor, at) VALUES (?, 'edit', 'relation', ?, ?, ?, ?, ?)`, [r.id, r.relation, rel, why, actor, at]]);
    stmts.push([`UPDATE beneficiaries SET relation = ?, review_status = 'modified', review_note = NULL, modified_reason = ?, version = version + 1, updated_at = ? WHERE id = ?`, [rel, why, at, r.id]]);
  }
  if (stmts.length) await db.batch(stmts);
  forgetGender();
  return { fixed: rows.length };
}

// TPA فقط: حالة المستفيد لدى الجهة (نشط/موقوف/مكتمل). لا تغيّر حالة المراجعة.
export const BEN_STATUSES = ['نشط', 'موقوف', 'مكتمل'];
export async function setBenStatus(id, status, reason, actor) {
  if (!BEN_STATUSES.includes(status)) throw new UserError('حالة المستفيد غير صحيحة.');
  const why = String(reason ?? '').trim();
  if (!why) throw new UserError('اكتب سبب التعديل قبل الحفظ.');
  const db = await getDb();
  const b = await db.get('SELECT * FROM beneficiaries WHERE id = ? AND deleted = 0', [Number(id)]);
  if (!b) throw new UserError('السجل غير موجود.');
  const old = b.legacy_status || 'نشط';
  if (old === status) return false;
  const at = nowIso();
  await db.batch([
    ['UPDATE beneficiaries SET legacy_status = ?, version = version + 1, updated_at = ? WHERE id = ?', [status, at, b.id]],
    [`INSERT INTO beneficiary_events (beneficiary_id, action, field, old_value, new_value, reason, actor, at) VALUES (?, 'status', 'legacy_status', ?, ?, ?, ?, ?)`, [b.id, old, status, why, actor, at]],
  ]);
  return true;
}

// TPA: حذف ناعم (قابل للاسترجاع) بسبب إلزامي. المرحَّل لا يُحذف.
export async function softDelete(id, reason, actor) {
  const why = String(reason ?? '').trim();
  if (!why) throw new UserError('اكتب سبب الحذف.');
  if (why.length > 300) throw new UserError('سبب الحذف أطول من 300 حرف.');
  const db = await getDb();
  const b = await db.get('SELECT * FROM beneficiaries WHERE id = ? AND deleted = 0', [Number(id)]);
  if (!b) throw new UserError('السجل غير موجود.');
  if (LOCKED.has(b.review_status)) throw new UserError('السجل مقفل بعد الترحيل ولا يمكن حذفه.');
  const at = nowIso();
  await db.batch([
    ['UPDATE beneficiaries SET deleted = 1, version = version + 1, updated_at = ? WHERE id = ?', [at, b.id]],
    [`INSERT INTO beneficiary_events (beneficiary_id, action, field, old_value, new_value, reason, actor, at) VALUES (?, 'delete', 'deleted', '0', '1', ?, ?, ?)`, [b.id, why, actor, at]],
  ]);
  return true;
}

export async function restoreDeleted(id, actor) {
  const db = await getDb();
  const b = await db.get('SELECT * FROM beneficiaries WHERE id = ? AND deleted = 1', [Number(id)]);
  if (!b) throw new UserError('السجل غير موجود في المحذوفات.');
  if (b.list_serial != null) {
    const taken = await db.get(
      'SELECT name FROM beneficiaries WHERE entity_id = ? AND intake_batch IS ? AND list_serial = ? AND deleted = 0 AND id <> ?',
      [b.entity_id, b.intake_batch, b.list_serial, b.id]
    );
    if (taken) throw new UserError(`لا يمكن الاسترجاع: التسلسل ${b.list_serial} في الدفعة ${b.intake_batch} أصبح لـ ${taken.name}.`);
  }
  const at = nowIso();
  await db.batch([
    ['UPDATE beneficiaries SET deleted = 0, version = version + 1, updated_at = ? WHERE id = ?', [at, b.id]],
    [`INSERT INTO beneficiary_events (beneficiary_id, action, field, old_value, new_value, reason, actor, at) VALUES (?, 'restore', 'deleted', '1', '0', 'استرجاع من المحذوفات', ?, ?)`, [b.id, actor, at]],
  ]);
  return true;
}

// TPA: إعادة السجل لجهة العمل مع ملاحظة إلزامية.
export async function returnForEdit(id, note, actor) {
  const text = String(note ?? '').trim();
  if (!text) throw new UserError('اكتب الملاحظة قبل الإرسال.');
  if (text.length > 300) throw new UserError('الملاحظة أطول من 300 حرف.');
  const db = await getDb();
  const b = await db.get('SELECT * FROM beneficiaries WHERE id = ? AND deleted = 0', [Number(id)]);
  if (!b) throw new UserError('السجل غير موجود.');
  if (LOCKED.has(b.review_status)) throw new UserError('السجل مقفل بعد الترحيل.');
  const at = nowIso();
  await db.batch([
    [`UPDATE beneficiaries SET review_status = 'needs_edit', review_note = ?, version = version + 1, updated_at = ? WHERE id = ?`, [text, at, b.id]],
    [`INSERT INTO beneficiary_events (beneficiary_id, action, reason, actor, at) VALUES (?, 'return', ?, ?, ?)`, [b.id, text, actor, at]],
  ]);
  return true;
}

function isReady(r) {
  return (r.review_status === 'correct' || r.review_status === 'modified') && r.photo_file && r.dob;
}

// TPA: ترحيل الجاهز فقط، في دفعة مستقلة لكل جهة.
export async function previewForward(target) {
  const rows = await resolveFull(await getDb(), target);
  const ready = rows.filter(isReady);
  const groups = {};
  for (const r of ready) groups[r.entity_id] = (groups[r.entity_id] || 0) + 1;
  return {
    ready: ready.length,
    notReady: rows.length - ready.length,
    groups: Object.entries(groups).map(([e, n]) => ({ entity: ENTITY_NAMES[e], count: n })),
  };
}

export async function forward(target, actor) {
  const db = await getDb();
  const ready = (await resolveFull(db, target)).filter(isReady);
  const byEntity = new Map();
  for (const r of ready) {
    if (!byEntity.has(r.entity_id)) byEntity.set(r.entity_id, []);
    byEntity.get(r.entity_id).push(r);
  }
  const at = nowIso();
  const batches = [];
  for (const [entityId, list] of byEntity) {
    const batchId = (await db.run('INSERT INTO print_batches (entity_id, created_at, created_by) VALUES (?, ?, ?)', [entityId, at, actor])).lastRowId;
    const [cond, p] = inList('id', list.map((r) => r.id));
    await db.batch([
      [`INSERT INTO beneficiary_events (beneficiary_id, action, new_value, actor, at)
        SELECT id, 'forward', ?, ?, ? FROM beneficiaries WHERE ${cond}`, [String(batchId), actor, at, p]],
      [`UPDATE beneficiaries SET review_status = 'forwarded', print_batch_id = ?, version = version + 1, updated_at = ? WHERE ${cond}`, [batchId, at, p]],
    ]);
    batches.push({ id: batchId, entity: ENTITY_NAMES[entityId], count: list.length });
  }
  return batches;
}

export async function listBatches(limit = 12) {
  const rows = await (await getDb()).all(
    `SELECT p.id, p.entity_id, p.created_at, COUNT(b.id) total,
       SUM(CASE WHEN b.review_status IN ('printed','delivered') THEN 1 ELSE 0 END) printed,
       SUM(CASE WHEN b.review_status = 'delivered' THEN 1 ELSE 0 END) delivered
     FROM print_batches p LEFT JOIN beneficiaries b ON b.print_batch_id = p.id
     GROUP BY p.id ORDER BY p.id DESC LIMIT ?`, [limit]
  );
  return rows.map((r) => ({ ...r, entity: ENTITY_NAMES[r.entity_id] }));
}

export async function intakeBatches(entityId) {
  const w = buildWhere({ entityId });
  const rows = await (await getDb()).all(`SELECT DISTINCT b.intake_batch v FROM beneficiaries b WHERE ${w.sql} AND b.intake_batch IS NOT NULL ORDER BY v`, w.params);
  return rows.map((r) => r.v);
}

// ---------- محوّل الشاشة القديمة ----------

export function photoPath(entityCode, file) {
  return path.join(STORAGE_DIR, entityCode, file);
}

// وجود ملف صورة محليًا (على Cloudflare لا يُفحص، ويبقى ما في القاعدة).
function localExists(code, file) {
  if (onCloudflare()) return null;
  return process.getBuiltinModule('node:fs').existsSync(photoPath(code, file));
}

export async function loadLegacyPeople() {
  const rows = await (await getDb()).all('SELECT * FROM beneficiaries ORDER BY id');
  return rows.map((r) => {
    const company = ENTITY_CODES[r.entity_id];
    const slug = r.photo_file ? r.photo_file.replace(/\.webp$/i, '') : `${r.name}_${r.card1 || r.card2 || r.id}`.replace(/[\\/:*?"<>|]/g, ' ');
    return {
      id: r.id,
      company,
      companyLabel: ENTITY_NAMES[r.entity_id],
      name: r.name,
      relation: r.relation,
      primaryName: isPrincipal(r.relation) ? '' : r.employee_name || '',
      job: r.job_no || '',
      national: r.national_id || '',
      dob: r.dob || '',
      card1: r.card1 || '',
      card2: r.card2 || '',
      status: r.legacy_status || '',
      photoSlug: slug,
      deleted: !!r.deleted,
      batch: r.intake_batch || undefined,
      reviewStatus: r.review_status,
    };
  });
}

const LEGACY_FIELDS = ['entity_id', 'family_key', 'job_no', 'employee_name', 'name', 'relation', 'dob', 'national_id', 'card1', 'card2', 'intake_batch', 'legacy_status', 'deleted'];

// يحفظ مصفوفة الشاشة القديمة: يُدرج الجديد ويحدّث المتغيّر فقط، ويسجّل التغييرات.
export async function saveLegacyPeople(people, actor = 'الشاشة القديمة') {
  const db = await getDb();
  const derived = deriveRows(people);
  const bySlug = new Map(people.map((p) => [p.id, p.photoSlug]));
  const current = new Map((await db.all('SELECT * FROM beneficiaries')).map((r) => [r.id, r]));
  const at = nowIso();
  const ev = `INSERT INTO beneficiary_events (beneficiary_id, action, field, old_value, new_value, actor, at) VALUES (?, ?, ?, ?, ?, ?, ?)`;
  const stmts = [];
  let changedCount = 0;
  for (const row of derived) {
    const code = ENTITY_CODES[row.entity_id];
    const slug = bySlug.get(row.id);
    const cur = current.get(row.id);
    let photo = cur?.photo_file || null;
    if (slug && localExists(code, `${slug}.webp`)) photo = `${slug}.webp`;
    else if (photo && localExists(code, photo) === false) photo = null;
    if (!cur) {
      stmts.push([
        `INSERT INTO beneficiaries (id, entity_id, family_key, job_no, employee_name, name, relation, dob, national_id, card1, card2,
         photo_file, intake_batch, legacy_status, deleted, search_key, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [row.id, row.entity_id, row.family_key, row.job_no, row.employee_name, row.name, row.relation, row.dob, row.national_id,
          row.card1, row.card2, photo, row.intake_batch, row.legacy_status, row.deleted, row.search_key, at],
      ]);
      stmts.push([ev, [row.id, 'add', null, null, null, actor, at]]);
      changedCount++;
      continue;
    }
    const diffs = LEGACY_FIELDS.filter((k) => (cur[k] ?? null) !== (row[k] ?? null) && String(cur[k] ?? '') !== String(row[k] ?? ''));
    if (!diffs.length && photo === cur.photo_file) continue;
    stmts.push([
      `UPDATE beneficiaries SET ${LEGACY_FIELDS.map((k) => `${k} = ?`).join(', ')}, photo_file = ?, search_key = ?, version = version + 1, updated_at = ? WHERE id = ?`,
      [...LEGACY_FIELDS.map((k) => row[k] ?? null), photo, row.search_key, at, row.id],
    ]);
    for (const k of diffs) {
      const action = k === 'deleted' ? (row.deleted ? 'delete' : 'restore') : 'legacy_edit';
      stmts.push([ev, [row.id, action, k, String(cur[k] ?? ''), String(row[k] ?? ''), actor, at]]);
    }
    if (photo !== cur.photo_file) stmts.push([ev, [row.id, 'photo', 'photo_file', cur.photo_file || '', photo || '', actor, at]]);
    changedCount++;
  }
  await db.batch(stmts);
  return changedCount;
}

export { ENTITY_IDS, ENTITY_NAMES, ENTITY_CODES };
