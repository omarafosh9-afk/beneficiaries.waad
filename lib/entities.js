// الجهات (الشركات) من جدول entities. الخرائط ENTITY_IDS/CODES/NAMES في derive.js تُملأ من القاعدة
// عند أول فتح لها وبعد كل إضافة، فيبقى الكود الذي يقرؤها كما هو.
import { ENTITY_IDS, ENTITY_CODES, ENTITY_NAMES } from './derive.js';

export async function loadEntities(db) {
  const rows = await db.all('SELECT id, code, name_ar, card_prefix FROM entities ORDER BY id');
  for (const r of rows) {
    ENTITY_IDS[r.code] = r.id;
    ENTITY_CODES[r.id] = r.code;
    ENTITY_NAMES[r.id] = r.name_ar;
  }
  return rows;
}

// للقوائم المنسدلة في الواجهة.
export function entityOptions() {
  return Object.entries(ENTITY_NAMES).map(([id, name]) => ({ id: Number(id), name }));
}

export async function listEntities() {
  const { getDb } = await import('./db.js');
  const db = await getDb();
  const rows = await loadEntities(db);
  const counts = await db.all(
    `SELECT entity_id, COUNT(*) n, COUNT(photo_file) photos, MAX(intake_batch) batches
     FROM beneficiaries WHERE deleted = 0 GROUP BY entity_id`
  );
  const by = Object.fromEntries(counts.map((c) => [c.entity_id, c]));
  return rows.map((r) => ({
    id: r.id, code: r.code, name: r.name_ar, prefix: r.card_prefix,
    count: by[r.id]?.n || 0, photos: by[r.id]?.photos || 0, batches: by[r.id]?.batches || 0,
  }));
}

function cleanName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim();
}

// تعديل الاسم العربي فقط؛ الرمز ثابت لأنه مسار صور الجهة.
export async function renameEntity(id, name) {
  const { getDb } = await import('./db.js');
  const { UserError } = await import('./beneficiaries.js');
  const db = await getDb();
  const ar = cleanName(name);
  if (!ar || ar.length > 60) throw new UserError('اسم الجهة مطلوب وبحد أقصى 60 حرفًا.');
  const rows = await loadEntities(db);
  if (!rows.some((r) => r.id === Number(id))) throw new UserError('الجهة غير موجودة.');
  if (rows.some((r) => r.name_ar === ar && r.id !== Number(id))) throw new UserError('توجد جهة بهذا الاسم.');
  await db.run('UPDATE entities SET name_ar = ? WHERE id = ?', [ar, Number(id)]);
  await loadEntities(db);
  return { name: ar };
}

// الحذف للجهة الفارغة فقط (بلا مستفيدين ولو محذوفين، وبلا حسابات أو دفعات طباعة).
export async function deleteEntity(id) {
  const { getDb } = await import('./db.js');
  const { UserError } = await import('./beneficiaries.js');
  const db = await getDb();
  const eid = Number(id);
  const used = await db.get(
    `SELECT (SELECT COUNT(*) FROM beneficiaries WHERE entity_id = ?) b, (SELECT COUNT(*) FROM users WHERE entity_id = ?) u,
            (SELECT COUNT(*) FROM print_batches WHERE entity_id = ?) p`, [eid, eid, eid]
  );
  if (used.b) throw new UserError('لا يمكن حذف جهة فيها مستفيدون.');
  if (used.u) throw new UserError('لا يمكن حذف جهة لها حسابات؛ احذف حساباتها أولًا.');
  if (used.p) throw new UserError('لا يمكن حذف جهة لها دفعات طباعة.');
  const { changes } = await db.run('DELETE FROM entities WHERE id = ?', [eid]);
  if (!changes) throw new UserError('الجهة غير موجودة.');
  const code = ENTITY_CODES[eid];
  delete ENTITY_IDS[code];
  delete ENTITY_CODES[eid];
  delete ENTITY_NAMES[eid];
  return {};
}

export async function createEntity({ name, code }) {
  const { getDb } = await import('./db.js');
  const { UserError } = await import('./beneficiaries.js');
  const db = await getDb();
  const ar = String(name ?? '').replace(/\s+/g, ' ').trim();
  const c = String(code ?? '').trim();
  if (!ar || ar.length > 60) throw new UserError('اسم الجهة مطلوب وبحد أقصى 60 حرفًا.');
  // الرمز اللاتيني هو اسم مجلد الصور ورابطها؛ لا يتغير بعد الإنشاء.
  if (!/^[A-Za-z][A-Za-z0-9]{1,19}$/.test(c)) throw new UserError('الرمز بالإنجليزية: حروف وأرقام فقط، من 2 إلى 20، يبدأ بحرف.');
  const rows = await loadEntities(db);
  if (rows.some((r) => r.name_ar === ar)) throw new UserError('توجد جهة بهذا الاسم.');
  if (rows.some((r) => r.code.toLowerCase() === c.toLowerCase())) throw new UserError('هذا الرمز مستخدم لجهة أخرى.');
  await db.run('INSERT INTO entities (code, name_ar, card_prefix) VALUES (?, ?, ?)', [c, ar, c.slice(0, 3).toUpperCase()]);
  await loadEntities(db);
  return { name: ar };
}
