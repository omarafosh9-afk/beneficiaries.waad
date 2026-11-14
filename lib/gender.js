// كشف خلط الجنس في صلة القرابة (ابن/ابنة، زوج/زوجة، أب/أم) من الاسم الأول.
// جنس الاسم يُتعلَّم من المنظومة نفسها: أسماء الآباء والأزواج واسم الأب (الكلمة الثانية) ذكور، وأسماء الأمهات والزوجات إناث.
// يُعلَّم الشخص فقط إن كان اسمه واضح الجنس ويخالف صلته؛ الأسماء المشتركة أو النادرة لا يُحكم عليها.
import { getDb } from './db.js';
import { normalizeAr } from './derive.js';

const REL_G = { 'ابن': 'M', 'ابنة': 'F', 'زوج': 'M', 'زوجة': 'F', 'أب': 'M', 'أم': 'F' };
export const FLIP = { 'ابن': 'ابنة', 'ابنة': 'ابن', 'زوج': 'زوجة', 'زوجة': 'زوج', 'أب': 'أم', 'أم': 'أب' };
const COMPOUND = new Set(['عبد', 'ابو', 'نور', 'سيف', 'صلاح', 'علاء', 'شمس', 'عز', 'محي', 'بدر']);
const TTL = 5 * 60 * 1000;

function firstName(name) {
  const w = normalizeAr(name).split(' ');
  return COMPOUND.has(w[0]) && w[1] ? `${w[0]} ${w[1]}` : w[0];
}

function genderOf(m, f, name) {
  const k = firstName(name);
  const a = m.get(k) || 0;
  const b = f.get(k) || 0;
  if ((a >= 3 && b === 0) || (a >= 10 && a >= 20 * b)) return 'M';
  if ((b >= 3 && a === 0) || (b >= 10 && b >= 20 * a)) return 'F';
  return null;
}

// id ← الصلة المقترحة، لكل السجلات المخالفة. تُحسب من كل الجهات (أسماء أكثر = حكم أدق) وتُخزَّن 5 دقائق.
export async function genderMismatches({ fresh = false } = {}) {
  const c = globalThis.__genderCache;
  if (!fresh && c && Date.now() - c.at < TTL) return c.map;
  const rows = await (await getDb()).all('SELECT id, name, relation FROM beneficiaries WHERE deleted = 0');
  const m = new Map();
  const f = new Map();
  const inc = (map, k) => map.set(k, (map.get(k) || 0) + 1);
  for (const r of rows) {
    if (r.relation === 'أب' || r.relation === 'زوج') inc(m, firstName(r.name));
    if (r.relation === 'أم' || r.relation === 'زوجة') inc(f, firstName(r.name));
    const w = normalizeAr(r.name).split(' ');
    if (w.length >= 3 && w[1] !== 'عبد') inc(m, w[1]);
  }
  const map = new Map();
  for (const r of rows) {
    const want = REL_G[r.relation];
    if (!want) continue;
    const g = genderOf(m, f, r.name);
    if (g && g !== want) map.set(r.id, FLIP[r.relation]);
  }
  globalThis.__genderCache = { at: Date.now(), map };
  return map;
}

export function forgetGender() {
  globalThis.__genderCache = null;
}
