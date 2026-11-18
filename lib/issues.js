// مركز المشاكل: فحوص تلقائية على بيانات كل جهة، تعيد لكل مشكلة عدد السجلات ومعرّفاتها (لعرضها في شاشة المراجعة)،
// ولبعضها إصلاح آمن تلقائي. الفحوص مبنية على مشاكل حدثت فعلًا (جليانة، وعد) حتى تُكتشف مبكرًا إن تكررت.
import { getDb, nowIso } from './db.js';
import { ENTITY_NAMES, normalizeAr, isPrincipal, buildSearchKey } from './derive.js';
import { genderMismatches, FLIP } from './gender.js';
import { UserError, LOCKED } from './beneficiaries.js';

const compact = (s) => normalizeAr(s).replace(/\s+/g, '');
const photoNumber = (reason) => {
  const m = /^ملف مضغوط:\s*(.+)$/.exec(reason || '');
  const n = m && /\d+/.exec(m[1].replace(/\.[^.]+$/, ''));
  return n ? Number(n[0]) : null;
};

// تعريف الفحوص: العنوان، والخطورة (high: يربط صورًا أو بطاقات خطأ، medium: بيانات ناقصة/متضاربة، low: للمراجعة)،
// وشرح السبب، والإصلاح التلقائي إن وُجد.
export const CHECKS = {
  photo_wrong: {
    title: 'صور مربوطة بالشخص الخطأ', severity: 'high',
    hint: 'رقم الصورة في اسم ملفها لا يطابق رقم صاحبها في القائمة، ويطابق تسلسله العام: رُفعت بطريقة «التسلسل العام» والرقمان مختلفان (مشكلة وعد).',
    fix: 'نقل كل صورة إلى صاحب رقمها في الدفعة، وفصل ما لا صاحب له.',
  },
  two_numbers: {
    title: 'التسلسل العام يختلف عن رقم القائمة', severity: 'high',
    hint: 'الجهة دفعة واحدة لكن التسلسل العام لا يساوي رقم القائمة، فرفع الصور بـ«التسلسل العام» يربطها بأشخاص آخرين.',
    fix: 'جعل التسلسل العام = رقم القائمة (آمن لأن الجهة دفعة واحدة).',
  },
  dup_name: {
    title: 'أسماء مكررة في العائلة نفسها', severity: 'high',
    hint: 'غالبًا نسخة ثانية للشخص نفسه (من إعادة استيراد بعد تعديل الاسم مثلًا).',
    fix: 'حذف ناعم للنسخ التي لم يعمل عليها أحد، وتبقى النسخة ذات الصورة أو المراجعة. ما فيه عمل في النسختين يُترك للمراجعة.',
  },
  no_serial: {
    title: 'بلا رقم في القائمة', severity: 'medium',
    hint: 'في جهة لها قائمة مرقّمة؛ لن تُربط صورته عند الرفع بالرقم.',
  },
  two_heads: {
    title: 'عائلة فيها أكثر من موظف', severity: 'medium',
    hint: 'عائلتان دُمجتا خطأ، أو صلة أحدهم خطأ.',
    fix: 'فصلها حسب ترتيب القائمة: كل موظف ومن تحته عائلة.',
  },
  no_head: {
    title: 'عائلة بلا موظف', severity: 'medium',
    hint: 'أفراد منفصلون عن عائلتهم أو الموظف غير مسجّل.',
    fix: 'ربطهم بموظفهم: بالرقم الوظيفي نفسه، أو بأقرب موظف فوقهم في القائمة (إن كانت الصفوف بينهما من عائلته). ما لا يُعرف موظفه يبقى.',
  },
  gender: {
    title: 'صلة القرابة تخالف جنس الاسم', severity: 'medium',
    hint: 'مثل «محمد» مسجّل «ابنة».',
    fix: 'قلب الصلة (ابنة↔ابن، زوجة↔زوج، أم↔أب) لكل السجلات غير المرحّلة.',
  },
  dob_copy: {
    title: 'مواليد فرد = مواليد الموظف تمامًا', severity: 'medium',
    hint: 'غالبًا نُسخت مواليد الموظف على أفراد عائلته (مشكلة جليانة).',
  },
  no_relation: {
    title: 'بلا صلة قرابة', severity: 'low',
    hint: 'حدّد الصلة من «تعديل».',
  },
};

async function rowsOf(db) {
  return db.all('SELECT id, entity_id e, family_key f, name, relation, dob, seq, intake_batch b, list_serial s, photo_file, review_status FROM beneficiaries WHERE deleted = 0');
}

// كل الفحوص: entity ← key ← [ids]
async function detect() {
  const db = await getDb();
  const rows = await rowsOf(db);
  const out = new Map();
  const add = (e, key, id) => {
    if (!out.has(e)) out.set(e, new Map());
    const m = out.get(e);
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(id);
  };
  const byEntity = new Map();
  for (const r of rows) (byEntity.get(r.e) || byEntity.set(r.e, []).get(r.e)).push(r);

  // صور ZIP: رقم الملف ≠ رقم صاحبها في الدفعة، ويساوي تسلسله العام.
  const ev = await db.all(
    `SELECT e.beneficiary_id id, e.reason, e.new_value FROM beneficiary_events e
     WHERE e.action = 'photo' AND e.reason LIKE 'ملف مضغوط:%' AND e.id IN (SELECT MAX(id) FROM beneficiary_events WHERE action = 'photo' GROUP BY beneficiary_id)`
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const x of ev) {
    const r = byId.get(x.id);
    if (!r || r.photo_file !== x.new_value) continue;
    const n = photoNumber(x.reason);
    if (n !== null && r.s != null && n !== r.s && n === r.seq) add(r.e, 'photo_wrong', r.id);
  }

  for (const [e, list] of byEntity) {
    const batches = new Set(list.map((r) => r.b).filter(Boolean));
    const hasList = list.some((r) => r.s != null);
    if (batches.size === 1) for (const r of list) if (r.s != null && r.seq !== r.s) add(e, 'two_numbers', r.id);
    if (hasList) for (const r of list) if (r.s == null) add(e, 'no_serial', r.id);
    const fams = new Map();
    for (const r of list) (fams.get(r.f) || fams.set(r.f, []).get(r.f)).push(r);
    for (const members of fams.values()) {
      const heads = members.filter((r) => isPrincipal(r.relation));
      if (heads.length > 1) for (const r of members) add(e, 'two_heads', r.id);
      if (!heads.length) for (const r of members) add(e, 'no_head', r.id);
      const seen = new Map();
      for (const r of members) {
        const k = compact(r.name);
        if (seen.has(k)) { add(e, 'dup_name', r.id); if (!seen.get(k).flagged) { add(e, 'dup_name', seen.get(k).id); seen.get(k).flagged = true; } }
        else seen.set(k, { id: r.id });
      }
      const head = heads[0];
      if (head && /^\d{4}-\d{2}-\d{2}$/.test(head.dob || '')) {
        for (const r of members) if (r !== head && r.dob === head.dob && ['ابن', 'ابنة', 'أب', 'أم'].includes(r.relation)) add(e, 'dob_copy', r.id);
      }
    }
    for (const r of list) if (!r.relation) add(e, 'no_relation', r.id);
  }
  for (const [id] of await genderMismatches()) { const r = byId.get(id); if (r) add(r.e, 'gender', id); }
  return out;
}

export async function scanIssues() {
  const found = await detect();
  const order = { high: 0, medium: 1, low: 2 };
  const list = [];
  for (const [e, m] of found) {
    for (const [key, ids] of m) {
      const c = CHECKS[key];
      list.push({ key, entityId: e, entity: ENTITY_NAMES[e] || e, count: ids.length, title: c.title, severity: c.severity, hint: c.hint, fix: c.fix || null });
    }
  }
  return list.sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);
}

// معرّفات مشكلة في جهة (لفلتر المراجعة «issue:KEY»).
export async function issueIds(entityId, key) {
  const m = (await detect()).get(Number(entityId));
  return m?.get(key) || [];
}

// ---------- إصلاح العائلات والمكرر جماعيًا (مع معاينة) ----------

// خطة ربط العائلات: لكل فرد يتغير موظفه { id, name, fromEmp, toEmp, key, emp }.
async function planFamilies(e, kind) {
  const db = await getDb();
  const rows = await db.all('SELECT * FROM beneficiaries WHERE entity_id = ? AND deleted = 0', [e]);
  const fams = new Map();
  for (const r of rows) (fams.get(r.family_key) || fams.set(r.family_key, []).get(r.family_key)).push(r);
  const headOf = (key) => (fams.get(key) || []).find((r) => isPrincipal(r.relation));
  const changes = [];
  const push = (r, key, emp) => {
    if (r.family_key === key && (r.employee_name || '') === (emp || '')) return;
    changes.push({ id: r.id, name: r.name, relation: r.relation, fromEmp: r.employee_name || '—', toEmp: emp || '—', key, emp, oldKey: r.family_key, row: r });
  };
  // ترتيب القائمة داخل كل دفعة.
  const byBatch = new Map();
  for (const r of rows) if (r.intake_batch && r.list_serial != null) (byBatch.get(r.intake_batch) || byBatch.set(r.intake_batch, []).get(r.intake_batch)).push(r);
  for (const l of byBatch.values()) l.sort((a, b) => a.list_serial - b.list_serial);

  if (kind === 'no_head') {
    for (const [key, members] of fams) {
      if (members.some((r) => isPrincipal(r.relation))) continue;
      // 1) الرقم الوظيفي نفسه لعائلة لها موظف = عائلة واحدة انقسمت.
      const job = members.find((r) => r.job_no)?.job_no;
      const byJob = job && [...fams.entries()].find(([k, m]) => k !== key && m.some((r) => r.job_no === job && isPrincipal(r.relation)));
      if (byJob) { const h = headOf(byJob[0]); for (const r of members) push(r, byJob[0], h.name); continue; }
      // 2) ترتيب القائمة: أقرب موظف فوقهم، بشرط أن كل الصفوف بينهما من عائلته أو من هذه العائلة.
      const first = members.filter((r) => r.list_serial != null).sort((a, b) => a.list_serial - b.list_serial)[0];
      if (!first) continue;
      const list = byBatch.get(first.intake_batch);
      const i = list.indexOf(first);
      let target = null;
      for (let j = i - 1; j >= 0 && !target; j--) if (isPrincipal(list[j].relation)) target = list[j];
      if (!target) continue;
      const between = list.slice(list.indexOf(target) + 1, i);
      if (between.some((x) => x.family_key !== target.family_key && x.family_key !== key)) continue;
      for (const r of members) push(r, target.family_key, target.name);
    }
  }
  if (kind === 'two_heads') {
    for (const [key, members] of fams) {
      const heads = members.filter((r) => isPrincipal(r.relation));
      if (heads.length < 2 || heads.some((r) => r.list_serial == null)) continue;
      // من بلا رقم في القائمة لا يُعرف موقعه: يبقى في مكانه.
      const sorted = members.filter((r) => r.list_serial != null).sort((a, b) => a.intake_batch - b.intake_batch || a.list_serial - b.list_serial);
      let cur = null;
      for (const r of sorted) {
        if (isPrincipal(r.relation)) cur = { key: cur ? `S${r.id}` : key, emp: r.name };
        const to = cur || { key, emp: heads[0].name };
        push(r, to.key, to.emp);
      }
    }
  }
  return changes;
}

// المكرر: يبقى الأكثر عملًا، وتُحذف حذفًا ناعمًا النسخ التي لم يعمل عليها أحد فقط.
async function planDuplicates(e) {
  const db = await getDb();
  const rows = await db.all('SELECT * FROM beneficiaries WHERE entity_id = ? AND deleted = 0', [e]);
  const touched = new Set((await db.all(
    `SELECT DISTINCT beneficiary_id id FROM beneficiary_events WHERE action IN ('edit', 'photo', 'approve', 'status', 'return')
     AND beneficiary_id IN (SELECT id FROM beneficiaries WHERE entity_id = ?)`, [e]
  )).map((x) => x.id));
  const work = (r) => (r.photo_file ? 8 : 0) + (r.review_status !== 'pending' ? 4 : 0) + (touched.has(r.id) ? 2 : 0) + (r.list_serial != null ? 1 : 0);
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.family_key}|${compact(r.name)}`;
    (groups.get(k) || groups.set(k, []).get(k)).push(r);
  }
  const changes = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const [keep, ...rest] = [...g].sort((a, b) => work(b) - work(a) || a.id - b.id);
    for (const r of rest) {
      if (r.photo_file || r.review_status !== 'pending' || touched.has(r.id)) continue; // فيها عمل: تُترك للمراجعة
      changes.push({ id: r.id, name: r.name, relation: r.relation, keep: keep.id, keepInfo: `${keep.photo_file ? 'بصورة' : 'بلا صورة'}${keep.list_serial != null ? `، رقم ${keep.list_serial}` : ''}` });
    }
  }
  return changes;
}

async function planFor(e, key) {
  if (key === 'no_head' || key === 'two_heads') return planFamilies(e, key);
  if (key === 'dup_name') return planDuplicates(e);
  return null;
}

// معاينة الإصلاح الجماعي: قائمة التغييرات قبل التأكيد.
export async function previewFix(entityId, key) {
  const plan = await planFor(Number(entityId), key);
  if (!plan) return null;
  const rows = plan.slice(0, 300).map((c) => (key === 'dup_name'
    ? `${c.name} (${c.relation || '—'}) ← حذف ناعم؛ تبقى النسخة ${c.keepInfo}`
    : c.fromEmp === c.toEmp ? `${c.name} (${c.relation || '—'}): يُضمّ إلى عائلة ${c.toEmp}` : `${c.name} (${c.relation || '—'}): الموظف ${c.fromEmp} ← ${c.toEmp}`));
  return { count: plan.length, rows, more: Math.max(0, plan.length - 300) };
}

// الإصلاحات التلقائية الآمنة.
export async function fixIssue(entityId, key, actor) {
  {
    const plan = await planFor(Number(entityId), key);
    if (plan) {
      const db = await getDb();
      const at = nowIso();
      const evSql = 'INSERT INTO beneficiary_events (beneficiary_id, action, field, old_value, new_value, reason, actor, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
      const stmts = [];
      for (const c of plan) {
        if (key === 'dup_name') {
          stmts.push(['UPDATE beneficiaries SET deleted = 1, version = version + 1, updated_at = ? WHERE id = ? AND deleted = 0', [at, c.id]]);
          stmts.push([evSql, [c.id, 'delete', 'deleted', '0', '1', `مركز المشاكل: نسخة مكررة من السجل ${c.keep}`, actor, at]]);
        } else {
          stmts.push(['UPDATE beneficiaries SET family_key = ?, employee_name = ?, search_key = ?, version = version + 1, updated_at = ? WHERE id = ?', [c.key, c.emp, buildSearchKey({ ...c.row, employee_name: c.emp }), at, c.id]]);
          stmts.push([evSql, [c.id, 'merge', 'family_key', c.oldKey, c.key, `مركز المشاكل: ربط بالموظف ${c.toEmp}`, actor, at]]);
        }
      }
      if (stmts.length) await db.batch(stmts);
      if (key === 'dup_name') (await import('./gender.js')).forgetGender();
      return { fixed: plan.length };
    }
  }
  const e = Number(entityId);
  if (!ENTITY_NAMES[e]) throw new UserError('الجهة غير موجودة.');
  const db = await getDb();
  const at = nowIso();
  const evSql = 'INSERT INTO beneficiary_events (beneficiary_id, action, field, old_value, new_value, reason, actor, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
  if (key === 'two_numbers') {
    const rows = await db.all('SELECT id, seq, list_serial s FROM beneficiaries WHERE entity_id = ? AND deleted = 0 AND list_serial IS NOT NULL AND seq IS NOT list_serial', [e]);
    const batches = await db.get('SELECT COUNT(DISTINCT intake_batch) n FROM beneficiaries WHERE entity_id = ? AND deleted = 0 AND intake_batch IS NOT NULL', [e]);
    if (batches.n !== 1) throw new UserError('الجهة فيها أكثر من دفعة؛ لا يُطبَّق هذا الإصلاح.');
    const stmts = [];
    for (const r of rows) {
      stmts.push(['UPDATE beneficiaries SET seq = ?, version = version + 1, updated_at = ? WHERE id = ?', [r.s, at, r.id]]);
      stmts.push([evSql, [r.id, 'list_sync', 'seq', String(r.seq ?? ''), String(r.s), 'مركز المشاكل: التسلسل العام = رقم القائمة', actor, at]]);
    }
    if (stmts.length) await db.batch(stmts);
    return { fixed: rows.length };
  }
  if (key === 'gender') {
    const ids = await issueIds(e, 'gender');
    const map = await genderMismatches({ fresh: true });
    const rows = ids.length ? await db.all(`SELECT id, relation, review_status FROM beneficiaries WHERE id IN (SELECT value FROM json_each(?))`, [JSON.stringify(ids)]) : [];
    const stmts = [];
    let n = 0;
    for (const r of rows) {
      if (LOCKED.has(r.review_status) || !map.has(r.id)) continue;
      const rel = FLIP[r.relation];
      stmts.push([evSql, [r.id, 'edit', 'relation', r.relation, rel, 'مركز المشاكل: الصلة تخالف جنس الاسم', actor, at]]);
      stmts.push(["UPDATE beneficiaries SET relation = ?, review_status = 'modified', modified_reason = 'تصحيح جماعي: صلة القرابة تخالف جنس الاسم', version = version + 1, updated_at = ? WHERE id = ?", [rel, at, r.id]]);
      n++;
    }
    if (stmts.length) await db.batch(stmts);
    (await import('./gender.js')).forgetGender();
    return { fixed: n };
  }
  if (key === 'photo_wrong') {
    const { relinkPhotos } = await import('./photo-relink.js');
    return relinkPhotos(e, actor);
  }
  throw new UserError('لا يوجد إصلاح تلقائي لهذه المشكلة؛ عالجها من شاشة المراجعة.');
}
