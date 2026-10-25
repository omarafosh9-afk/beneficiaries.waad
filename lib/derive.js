// دوال نقية: تطبيع النص العربي للبحث، واشتقاق مفتاح العائلة والرقم الوظيفي
// واسم الموظف من البيانات القديمة (people.json) عند الترحيل.

export const ENTITY_IDS = { Cement: 1, Jalyana: 2, Jamarek: 3 };
export const ENTITY_CODES = { 1: 'Cement', 2: 'Jalyana', 3: 'Jamarek' };
export const ENTITY_NAMES = { 1: 'الاسمنت', 2: 'جليانة', 3: 'الجمارك' };

const BIDI = /[‎‏‪-‮⁦-⁩]/g;

export function normalizeAr(s) {
  return String(s ?? '')
    .replace(BIDI, '')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ىئ]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function buildSearchKey(b) {
  return normalizeAr([b.name, b.employee_name, b.job_no, b.card1, b.card2, b.national_id].filter(Boolean).join(' '));
}

const CARD_RE = /^(?:LCC|JFZ|JMR)2025(VIP)?0*(\d+)/i;

export function familyKeyFromCard(card) {
  const m = CARD_RE.exec(String(card || '').trim());
  if (!m) return null;
  return (m[1] ? 'VIP' : '') + (m[2] || '0');
}

const PRINCIPAL = new Set(['موظف أساسي', 'موظف']);
export function isPrincipal(relation) {
  return PRINCIPAL.has(relation);
}

// يحوّل سجلات people.json إلى صفوف جدول beneficiaries (بلا photo_file - يحدده المستدعي).
export function deriveRows(people) {
  const rows = people.map((p) => {
    const entity_id = ENTITY_IDS[p.company];
    if (!entity_id) throw new Error(`جهة غير معروفة: ${p.company} (id ${p.id})`);
    const fk = familyKeyFromCard(p.card1) || familyKeyFromCard(p.card2) || `id:${p.id}`;
    return { p, entity_id, family_key: fk };
  });

  const principals = new Map(); // entity|family -> principal person
  for (const r of rows) {
    if (isPrincipal(r.p.relation) && !r.p.deleted) {
      const k = r.entity_id + '|' + r.family_key;
      if (!principals.has(k)) principals.set(k, r.p);
    }
  }

  return rows.map(({ p, entity_id, family_key }) => {
    const principal = principals.get(entity_id + '|' + family_key);
    let job_no = p.job || null;
    if (!job_no && entity_id === ENTITY_IDS.Cement) job_no = principal?.job || null;
    else if (!job_no && /^\d+$/.test(family_key)) job_no = family_key;
    const employee_name = isPrincipal(p.relation)
      ? p.name
      : p.primaryName || principal?.name || null;
    const row = {
      id: p.id,
      entity_id,
      family_key,
      job_no: job_no ? String(job_no) : null,
      employee_name,
      name: String(p.name || '').trim(),
      relation: p.relation || '',
      dob: p.dob || null,
      national_id: p.national ? String(p.national) : null,
      card1: p.card1 || null,
      card2: p.card2 || null,
      intake_batch: p.batch || null,
      legacy_status: p.status || null,
      deleted: p.deleted ? 1 : 0,
    };
    row.search_key = buildSearchKey(row);
    return row;
  });
}

const REL_ORDER = { 'موظف أساسي': 0, 'موظف': 0, 'زوج': 1, 'زوجة': 1, 'ابن': 2, 'ابنة': 2, 'أب': 3, 'أم': 4 };
export function relationRank(rel) {
  return REL_ORDER[rel] ?? 5;
}

// يقبل YYYY أو YYYY/MM/DD أو YYYY-MM-DD ويعيد الصيغة المخزّنة، أو null إن كان غير صالح.
export function parseDob(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  let m = /^(\d{4})$/.exec(s);
  if (m) {
    const y = +m[1];
    return y >= 1900 && y <= new Date().getFullYear() ? m[1] : null;
  }
  // يقبل YYYY/MM/DD وكذلك DD/MM/YYYY (صيغة الإدخال في لوحة التعديل).
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  m = dmy ? [s, dmy[3], dmy[2], dmy[1]] : /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1900 || dt > new Date()) return null;
  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
