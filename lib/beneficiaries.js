// كل القراءة والكتابة على جدول المستفيدين: شاشة جهة العمل، شاشة الشركة (TPA)،
// ومحوّل للشاشة القديمة (البحث/الإضافة/الاستيراد) يحافظ على شكل بياناتها السابق.
import fs from 'node:fs';
import path from 'node:path';
import { getDb, tx, nowIso, STORAGE_DIR } from './db.js';
import {
  ENTITY_CODES, ENTITY_NAMES, ENTITY_IDS, normalizeAr, buildSearchKey, deriveRows, relationRank, isPrincipal,
} from './derive.js';

export const STATUSES = ['pending', 'needs_edit', 'correct', 'modified', 'forwarded', 'printed', 'delivered'];
export const LOCKED = new Set(['forwarded', 'printed', 'delivered']);
export const RELATIONS = ['موظف أساسي', 'زوجة', 'زوج', 'ابن', 'ابنة', 'أب', 'أم'];
export const FAMILIES_PER_PAGE = 20;
export const ROWS_PER_PAGE = 50;

const COMPLETE_SQL = "(b.photo_file IS NOT NULL AND b.dob IS NOT NULL AND b.dob <> '')";

function placeholders(n) {
  return Array(n).fill('?').join(',');
}

// يبني شرط WHERE من الفلاتر. tab=ready (لـ TPA): صحيح/معدل ومكتمل.
export function buildWhere(f, { withTab = true } = {}) {
  const parts = ['b.deleted = 0'];
  const params = [];
  if (f.entityId) { parts.push('b.entity_id = ?'); params.push(f.entityId); }
  if (f.relation) { parts.push('b.relation = ?'); params.push(f.relation); }
  if (f.completeness === 'complete') parts.push(COMPLETE_SQL);
  if (f.completeness === 'missing') parts.push(`NOT ${COMPLETE_SQL}`);
  if (f.completeness === 'no_photo') parts.push('b.photo_file IS NULL');
  if (f.completeness === 'no_dob') parts.push("(b.dob IS NULL OR b.dob = '')");
  if (f.completeness === 'no_employee') parts.push("(b.employee_name IS NULL OR b.employee_name = '' OR b.job_no IS NULL OR b.job_no = '')");
  if (f.intake) { parts.push('b.intake_batch = ?'); params.push(Number(f.intake)); }
  const q = normalizeAr(f.q);
  if (q) { parts.push('b.search_key LIKE ?'); params.push(`%${q}%`); }
  if (withTab && f.tab && f.tab !== 'all') {
    if (f.tab === 'ready') parts.push(`b.review_status IN ('correct','modified') AND ${COMPLETE_SQL}`);
    else { parts.push('b.review_status = ?'); params.push(f.tab); }
  }
  return { sql: parts.join(' AND '), params };
}

export function photoUrl(entityId, file) {
  return file ? `/photos/${ENTITY_CODES[entityId]}/${encodeURIComponent(file)}` : null;
}

function prevValues(db, ids) {
  const out = {};
  if (!ids.length) return out;
  const rows = db.prepare(
    `SELECT beneficiary_id, field, old_value FROM beneficiary_events
     WHERE action = 'edit' AND beneficiary_id IN (${placeholders(ids.length)}) ORDER BY id`
  ).all(...ids);
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
    employeeName: r.employee_name,
    name: r.name,
    relation: r.relation,
    dob: r.dob || '',
    card: r.card1 || r.card2 || '',
    photoUrl: photoUrl(r.entity_id, r.photo_file),
    status: r.review_status,
    note: r.review_note || '',
    reason: r.modified_reason || '',
    batch: r.print_batch_id,
    version: r.version,
    prev: prev?.[r.id] || {},
  };
}

function sortMembers(list) {
  return list.sort((a, b) => relationRank(a.relation) - relationRank(b.relation) || a.id - b.id);
}

// الفرز: job (افتراضي) | name | employee، والاتجاه asc | desc.
const JOB_SQL = "CAST(COALESCE(NULLIF(b.job_no, ''), b.family_key) AS INTEGER)";
function orderSql(f, grouped) {
  const dir = f.dir === 'desc' ? 'DESC' : 'ASC';
  if (grouped) {
    if (f.sort === 'name' || f.sort === 'employee') return `MIN(COALESCE(NULLIF(b.employee_name, ''), b.name)) ${dir}, b.family_key`;
    return `MIN(${JOB_SQL}) ${dir}, b.family_key`;
  }
  if (f.sort === 'name') return `b.search_key ${dir}, b.id`;
  if (f.sort === 'employee') return `COALESCE(b.employee_name, '') ${dir}, ${JOB_SQL}, b.id`;
  return `${JOB_SQL} ${dir}, b.family_key, b.id`;
}

export function listBeneficiaries(f) {
  const db = getDb();
  const page = Math.max(1, Number(f.page) || 1);
  const base = buildWhere(f, { withTab: false });
  const counts = { all: 0 };
  for (const s of STATUSES) counts[s] = 0;
  for (const r of db.prepare(`SELECT b.review_status s, COUNT(*) n FROM beneficiaries b WHERE ${base.sql} GROUP BY s`).all(...base.params)) {
    counts[r.s] = r.n;
    counts.all += r.n;
  }
  counts.ready = db.prepare(`SELECT COUNT(*) n FROM beneficiaries b WHERE ${base.sql} AND b.review_status IN ('correct','modified') AND ${COMPLETE_SQL}`).get(...base.params).n;

  const scope = buildWhere({ entityId: f.entityId });
  const prog = db.prepare(
    `SELECT COUNT(*) total, SUM(CASE WHEN b.review_status NOT IN ('pending','needs_edit') THEN 1 ELSE 0 END) done
     FROM beneficiaries b WHERE ${scope.sql}`
  ).get(...scope.params);

  const w = buildWhere(f);
  let rows;
  let total;
  let totalPages;
  if (f.grouped) {
    total = db.prepare(`SELECT COUNT(DISTINCT b.entity_id || '|' || b.family_key) n FROM beneficiaries b WHERE ${w.sql}`).get(...w.params).n;
    totalPages = Math.max(1, Math.ceil(total / FAMILIES_PER_PAGE));
    const fams = db.prepare(
      `SELECT b.entity_id e, b.family_key k FROM beneficiaries b WHERE ${w.sql}
       GROUP BY b.entity_id, b.family_key
       ORDER BY ${orderSql(f, true)} LIMIT ? OFFSET ?`
    ).all(...w.params, FAMILIES_PER_PAGE, (page - 1) * FAMILIES_PER_PAGE);
    rows = fams.length
      ? db.prepare(
          `SELECT b.* FROM beneficiaries b WHERE ${w.sql} AND (b.entity_id || '|' || b.family_key) IN (${placeholders(fams.length)})`
        ).all(...w.params, ...fams.map((x) => x.e + '|' + x.k))
      : [];
    const prev = prevValues(db, rows.map((r) => r.id));
    const byKey = new Map(fams.map((x) => [x.e + '|' + x.k, []]));
    for (const r of rows) byKey.get(r.entity_id + '|' + r.family_key)?.push(toView(r, prev));
    const families = fams.map((x) => {
      const members = sortMembers(byKey.get(x.e + '|' + x.k));
      const principal = members.find((m) => isPrincipal(m.relation));
      return {
        key: x.e + '|' + x.k,
        entityId: x.e,
        entity: ENTITY_NAMES[x.e],
        familyKey: x.k,
        jobNo: members.find((m) => m.jobNo)?.jobNo || '',
        employeeName: principal?.name || members.find((m) => m.employeeName)?.employeeName || '',
        members,
      };
    });
    return { counts, progress: { done: prog.done || 0, total: prog.total }, page, totalPages, total, families };
  }
  total = db.prepare(`SELECT COUNT(*) n FROM beneficiaries b WHERE ${w.sql}`).get(...w.params).n;
  totalPages = Math.max(1, Math.ceil(total / ROWS_PER_PAGE));
  rows = db.prepare(
    `SELECT b.* FROM beneficiaries b WHERE ${w.sql}
     ORDER BY ${orderSql(f, false)} LIMIT ? OFFSET ?`
  ).all(...w.params, ROWS_PER_PAGE, (page - 1) * ROWS_PER_PAGE);
  const prev = prevValues(db, rows.map((r) => r.id));
  return { counts, progress: { done: prog.done || 0, total: prog.total }, page, totalPages, total, rows: rows.map((r) => toView(r, prev)) };
}

export function exportRows(f) {
  const db = getDb();
  const w = buildWhere(f);
  return db.prepare(
    `SELECT b.* FROM beneficiaries b WHERE ${w.sql} ORDER BY ${orderSql(f, false)}`
  ).all(...w.params).map((r) => toView(r));
}

// الهدف: { ids: [...] } أو { filter: {...} }. scopeEntityId يحصر العملية في جهة المستخدم.
function resolveTargets(db, target, scopeEntityId) {
  let rows;
  if (target?.filter) {
    const w = buildWhere({ ...target.filter, entityId: scopeEntityId || target.filter.entityId });
    rows = db.prepare(`SELECT b.id, b.review_status, b.entity_id, b.name, b.photo_file, b.dob FROM beneficiaries b WHERE ${w.sql}`).all(...w.params);
  } else {
    const ids = (target?.ids || []).map(Number).filter(Number.isInteger);
    if (!ids.length) return [];
    rows = db.prepare(`SELECT b.id, b.review_status, b.entity_id, b.name, b.photo_file, b.dob FROM beneficiaries b WHERE b.deleted = 0 AND b.id IN (${placeholders(ids.length)})`).all(...ids);
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

export function previewApproval(target, scopeEntityId) {
  const c = classify(resolveTargets(getDb(), target, scopeEntityId));
  return {
    approve: c.ok.length,
    needs: c.needs,
    same: c.same,
    incompleteCount: c.incomplete.length,
    incomplete: c.incomplete.slice(0, 50).map((r) => ({ id: r.id, name: r.name, missing: missingOf(r) })),
  };
}

export function approve(target, actor, scopeEntityId) {
  const db = getDb();
  return tx(db, () => {
    const c = classify(resolveTargets(db, target, scopeEntityId));
    const at = nowIso();
    const upd = db.prepare(`UPDATE beneficiaries SET review_status = 'correct', version = version + 1, updated_at = ? WHERE id = ? AND review_status = 'pending'`);
    const ev = db.prepare(`INSERT INTO beneficiary_events (beneficiary_id, action, actor, at) VALUES (?, 'approve', ?, ?)`);
    for (const r of c.ok) { upd.run(at, r.id); ev.run(r.id, actor, at); }
    return {
      approved: c.ok.length,
      needs: c.needs,
      same: c.same,
      incompleteCount: c.incomplete.length,
      incomplete: c.incomplete.slice(0, 50).map((r) => ({ id: r.id, name: r.name, missing: missingOf(r) })),
    };
  });
}

export class UserError extends Error {}

export function getBeneficiary(id) {
  return getDb().prepare('SELECT * FROM beneficiaries WHERE id = ?').get(Number(id));
}

// تعديل جهة العمل: سبب إلزامي وتغيير فعلي؛ يصبح السجل «معدل».
export function editBeneficiary({ id, version, name, relation, dob, reason, photoFile }, actor, scopeEntityId) {
  const db = getDb();
  return tx(db, () => {
    const b = db.prepare('SELECT * FROM beneficiaries WHERE id = ? AND deleted = 0').get(Number(id));
    if (!b || (scopeEntityId && b.entity_id !== scopeEntityId)) throw new UserError('السجل غير موجود.');
    if (LOCKED.has(b.review_status)) throw new UserError('السجل مقفل بعد الترحيل ولا يمكن تعديله.');
    if (Number(version) !== b.version) throw new UserError('عُدّل هذا السجل للتو من مكان آخر؛ حدّث الصفحة.');
    const next = { name: String(name ?? '').replace(/\s+/g, ' ').trim(), relation, dob: dob || null };
    if (!next.name || next.name.length > 120) throw new UserError('الاسم مطلوب وبحد أقصى 120 حرفًا.');
    if (!RELATIONS.includes(next.relation)) throw new UserError('صلة القرابة غير صحيحة.');
    const changed = ['name', 'relation', 'dob'].filter((k) => (next[k] || '') !== (b[k] || ''));
    if (!changed.length && !photoFile) throw new UserError('لم يتغيّر شيء في البيانات.');
    const why = String(reason ?? '').trim();
    if (!why) throw new UserError('اكتب سبب التعديل قبل الحفظ.');
    if (why.length > 300) throw new UserError('سبب التعديل أطول من 300 حرف.');
    const at = nowIso();
    const ev = db.prepare(`INSERT INTO beneficiary_events (beneficiary_id, action, field, old_value, new_value, reason, actor, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const k of changed) ev.run(b.id, 'edit', k, b[k] || '', next[k] || '', why, actor, at);
    if (photoFile) ev.run(b.id, 'photo', 'photo_file', b.photo_file || '', photoFile, why, actor, at);
    const merged = { ...b, ...next, photo_file: photoFile || b.photo_file };
    db.prepare(
      `UPDATE beneficiaries SET name = ?, relation = ?, dob = ?, photo_file = ?, review_status = 'modified', review_note = NULL,
       modified_reason = ?, search_key = ?, version = version + 1, updated_at = ? WHERE id = ?`
    ).run(merged.name, merged.relation, merged.dob, merged.photo_file, why, buildSearchKey(merged), at, b.id);
    return toView(db.prepare('SELECT * FROM beneficiaries WHERE id = ?').get(b.id));
  });
}

// TPA: إعادة السجل لجهة العمل مع ملاحظة إلزامية.
export function returnForEdit(id, note, actor) {
  const db = getDb();
  const text = String(note ?? '').trim();
  if (!text) throw new UserError('اكتب الملاحظة قبل الإرسال.');
  if (text.length > 300) throw new UserError('الملاحظة أطول من 300 حرف.');
  return tx(db, () => {
    const b = db.prepare('SELECT * FROM beneficiaries WHERE id = ? AND deleted = 0').get(Number(id));
    if (!b) throw new UserError('السجل غير موجود.');
    if (LOCKED.has(b.review_status)) throw new UserError('السجل مقفل بعد الترحيل.');
    const at = nowIso();
    db.prepare(`UPDATE beneficiaries SET review_status = 'needs_edit', review_note = ?, version = version + 1, updated_at = ? WHERE id = ?`).run(text, at, b.id);
    db.prepare(`INSERT INTO beneficiary_events (beneficiary_id, action, reason, actor, at) VALUES (?, 'return', ?, ?, ?)`).run(b.id, text, actor, at);
    return true;
  });
}

function isReady(r) {
  return (r.review_status === 'correct' || r.review_status === 'modified') && r.photo_file && r.dob;
}

// TPA: ترحيل الجاهز فقط، في دفعة مستقلة لكل جهة.
export function previewForward(target) {
  const db = getDb();
  const rows = resolveFull(db, target);
  const ready = rows.filter(isReady);
  const groups = {};
  for (const r of ready) groups[r.entity_id] = (groups[r.entity_id] || 0) + 1;
  return {
    ready: ready.length,
    notReady: rows.length - ready.length,
    groups: Object.entries(groups).map(([e, n]) => ({ entity: ENTITY_NAMES[e], count: n })),
  };
}

function resolveFull(db, target) {
  if (target?.filter) {
    const w = buildWhere(target.filter);
    return db.prepare(`SELECT b.* FROM beneficiaries b WHERE ${w.sql}`).all(...w.params);
  }
  const ids = (target?.ids || []).map(Number).filter(Number.isInteger);
  if (!ids.length) return [];
  return db.prepare(`SELECT b.* FROM beneficiaries b WHERE b.deleted = 0 AND b.id IN (${placeholders(ids.length)})`).all(...ids);
}

export function forward(target, actor) {
  const db = getDb();
  return tx(db, () => {
    const ready = resolveFull(db, target).filter(isReady);
    const byEntity = new Map();
    for (const r of ready) {
      if (!byEntity.has(r.entity_id)) byEntity.set(r.entity_id, []);
      byEntity.get(r.entity_id).push(r);
    }
    const at = nowIso();
    const batches = [];
    for (const [entityId, list] of byEntity) {
      const batchId = Number(db.prepare('INSERT INTO print_batches (entity_id, created_at, created_by) VALUES (?, ?, ?)').run(entityId, at, actor).lastInsertRowid);
      const upd = db.prepare(`UPDATE beneficiaries SET review_status = 'forwarded', print_batch_id = ?, version = version + 1, updated_at = ? WHERE id = ?`);
      const ev = db.prepare(`INSERT INTO beneficiary_events (beneficiary_id, action, new_value, actor, at) VALUES (?, 'forward', ?, ?, ?)`);
      for (const r of list) { upd.run(batchId, at, r.id); ev.run(r.id, String(batchId), actor, at); }
      batches.push({ id: batchId, entity: ENTITY_NAMES[entityId], count: list.length });
    }
    return batches;
  });
}

export function listBatches(limit = 12) {
  return getDb().prepare(
    `SELECT p.id, p.entity_id, p.created_at, COUNT(b.id) total,
       SUM(CASE WHEN b.review_status IN ('printed','delivered') THEN 1 ELSE 0 END) printed,
       SUM(CASE WHEN b.review_status = 'delivered' THEN 1 ELSE 0 END) delivered
     FROM print_batches p LEFT JOIN beneficiaries b ON b.print_batch_id = p.id
     GROUP BY p.id ORDER BY p.id DESC LIMIT ?`
  ).all(limit).map((r) => ({ ...r, entity: ENTITY_NAMES[r.entity_id] }));
}

export function intakeBatches(entityId) {
  const w = buildWhere({ entityId });
  return getDb().prepare(`SELECT DISTINCT b.intake_batch v FROM beneficiaries b WHERE ${w.sql} AND b.intake_batch IS NOT NULL ORDER BY v`).all(...w.params).map((r) => r.v);
}

// ---------- محوّل الشاشة القديمة ----------

export function photoPath(entityCode, file) {
  return path.join(STORAGE_DIR, entityCode, file);
}

export function loadLegacyPeople() {
  return getDb().prepare('SELECT * FROM beneficiaries ORDER BY id').all().map((r) => {
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
export function saveLegacyPeople(people, actor = 'الشاشة القديمة') {
  const db = getDb();
  const derived = deriveRows(people);
  const bySlug = new Map(people.map((p) => [p.id, p.photoSlug]));
  return tx(db, () => {
    const current = new Map(db.prepare('SELECT * FROM beneficiaries').all().map((r) => [r.id, r]));
    const at = nowIso();
    const ev = db.prepare(`INSERT INTO beneficiary_events (beneficiary_id, action, field, old_value, new_value, actor, at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    let changedCount = 0;
    for (const row of derived) {
      const code = ENTITY_CODES[row.entity_id];
      const slug = bySlug.get(row.id);
      const cur = current.get(row.id);
      let photo = cur?.photo_file || null;
      if (slug && fs.existsSync(photoPath(code, `${slug}.webp`))) photo = `${slug}.webp`;
      else if (photo && !fs.existsSync(photoPath(code, photo))) photo = null;
      if (!cur) {
        db.prepare(
          `INSERT INTO beneficiaries (id, entity_id, family_key, job_no, employee_name, name, relation, dob, national_id, card1, card2,
           photo_file, intake_batch, legacy_status, deleted, search_key, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).run(row.id, row.entity_id, row.family_key, row.job_no, row.employee_name, row.name, row.relation, row.dob, row.national_id,
          row.card1, row.card2, photo, row.intake_batch, row.legacy_status, row.deleted, row.search_key, at);
        ev.run(row.id, 'add', null, null, null, actor, at);
        changedCount++;
        continue;
      }
      const diffs = LEGACY_FIELDS.filter((k) => (cur[k] ?? null) !== (row[k] ?? null) && String(cur[k] ?? '') !== String(row[k] ?? ''));
      if (!diffs.length && photo === cur.photo_file) continue;
      db.prepare(
        `UPDATE beneficiaries SET ${LEGACY_FIELDS.map((k) => `${k} = ?`).join(', ')}, photo_file = ?, search_key = ?, version = version + 1, updated_at = ? WHERE id = ?`
      ).run(...LEGACY_FIELDS.map((k) => row[k] ?? null), photo, row.search_key, at, row.id);
      for (const k of diffs) {
        const action = k === 'deleted' ? (row.deleted ? 'delete' : 'restore') : 'legacy_edit';
        ev.run(row.id, action, k, String(cur[k] ?? ''), String(row[k] ?? ''), actor, at);
      }
      if (photo !== cur.photo_file) ev.run(row.id, 'photo', 'photo_file', cur.photo_file || '', photo || '', actor, at);
      changedCount++;
    }
    return changedCount;
  });
}

export { ENTITY_IDS, ENTITY_NAMES, ENTITY_CODES };
