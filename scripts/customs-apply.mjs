// يطبّق قائمة الجمارك الموحدة على قاعدة المنظومة: الاسم، المواليد، حالة المستفيد،
// إضافة الناقصين، وربط الصور بأصحابها برقم البطاقة الموجود في اسم ملف الصورة.
// بلا --apply: تقرير فقط (لا يُكتب شيء). مع --apply: نسخة احتياطية ثم التنفيذ في معاملة واحدة.
// الاستخدام: node scripts/customs-apply.mjs "<ملف القائمة الموحدة>" [--apply]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { openDb, tx, nowIso, DATA_DIR } from '../lib/db-node.js';
import { STORAGE_DIR } from '../lib/photos.js';
import { buildSearchKey, familyKeyFromCard, isPrincipal, normalizeAr } from '../lib/derive.js';

const XLSX = createRequire(import.meta.url)('xlsx');
const file = process.argv[2];
const apply = process.argv.includes('--apply');
if (!file) throw new Error('حدد ملف القائمة الموحدة');
const ENTITY = 3; // الجمارك
const ACTOR = 'قائمة الجمارك الموحدة';

const card = (c) => {
  const s = String(c || '').trim().toUpperCase();
  const m = /^(JMR2025)(VIP)?0*(\d+)([A-Z]+\d*)?$/.exec(s);
  return m ? `${m[1]}${m[2] || ''}${m[3]}${m[4] || ''}` : s;
};
const toIso = (d) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(d || '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};
// الصلة من لاحقة رقم البطاقة.
const REL = { W: 'زوجة', H: 'زوج', S: 'ابن', D: 'ابنة', F: 'أب', M: 'أم' };
const relationOf = (c) => {
  const m = /^JMR2025(?:VIP)?\d+([A-Z])/.exec(c);
  return m ? REL[m[1]] || '' : 'موظف أساسي';
};

const list = XLSX.utils.sheet_to_json(XLSX.readFile(file).Sheets['القائمة الموحدة'], { defval: '', raw: false })
  .filter((r) => r['رقم البطاقة']);

const db = openDb();
const rows = db.prepare('SELECT * FROM beneficiaries WHERE entity_id = ? AND deleted = 0').all(ENTITY);
// السجل الأساسي لكل رقم بطاقة: المكتوب بلا صفر زائد. السجلات برقم فيه صفر زائد «بدائل»
// قد تكون نسخة مكررة لنفس الشخص أو شخصًا آخر يحمل الرقم خطأ.
const byCard = new Map();
const aliases = [];
const sorted = [...rows].sort((a, b) => Number(card(a.card1) !== String(a.card1).toUpperCase()) - Number(card(b.card1) !== String(b.card1).toUpperCase()));
for (const r of sorted) {
  const c = card(r.card1 || r.card2);
  if (!byCard.has(c)) byCard.set(c, r);
  else aliases.push(r);
}
const excludedNames = new Set(
  (XLSX.readFile(file).Sheets['مستبعدون'] ? XLSX.utils.sheet_to_json(XLSX.readFile(file).Sheets['مستبعدون'], { defval: '' }) : [])
    .map((r) => normalizeAr(r['اسم المستفيد']))
);

// فهرس الصور: رقم البطاقة في اسم الملف ← الملفات.
const photoIndex = new Map();
const dir = path.join(STORAGE_DIR, 'Jamarek');
for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
  const m = /(JMR2025[A-Z0-9]+)\.webp$/i.exec(f);
  if (!m) continue;
  const c = card(m[1]);
  if (!photoIndex.has(c)) photoIndex.set(c, []);
  photoIndex.get(c).push(f);
}
// الاسم داخل اسم ملف الصورة (الصيغة: <الاسم>_<رقم البطاقة>.webp).
const nameInFile = (f) => normalizeAr(String(f || '').replace(/_?JMR2025[A-Z0-9]+\.webp$/i, ''));
// صور كل عائلة بالاسم، لإيجاد صورة شخص نُقل إلى رقم آخر داخل عائلته.
const familyPhotos = new Map();
for (const [c, files] of photoIndex) {
  const fam = familyKeyFromCard(c);
  if (!familyPhotos.has(fam)) familyPhotos.set(fam, []);
  for (const f of files) familyPhotos.get(fam).push(f);
}
// الصورة الصحيحة لاسم داخل عائلة: ملف واحد يحمل نفس الاسم.
const familyPhotoByName = (c, name) => {
  const hits = (familyPhotos.get(familyKeyFromCard(c)) || []).filter((f) => nameInFile(f) === normalizeAr(name));
  return hits.length === 1 ? hits[0] : null;
};

// صورة البطاقة: ملف واحد، أو عند وجود أكثر من ملف: الملف الذي يطابق اسم صاحبه.
const photoFor = (c, name) => {
  const files = photoIndex.get(c) || [];
  if (files.length === 1) return files[0];
  const byName = files.filter((f) => normalizeAr(f.replace(/_?JMR2025[A-Z0-9]+\.webp$/i, '')) === normalizeAr(name));
  return byName.length === 1 ? byName[0] : null;
};

const plan = { rename: [], dob: [], status: [], photoLink: [], photoFix: [], insert: [], ambiguousPhoto: [], reassign: [], dupDelete: [], exclude: [], aliasUnknown: [], photoUnlink: [] };
const listCards = new Set();
for (const r of list) {
  const c = card(r['رقم البطاقة']);
  listCards.add(c);
  const name = String(r['اسم المستفيد']).trim();
  const birth = toIso(r['المواليد']);
  const status = String(r['حالة المستفيد'] || '').trim() || 'نشط';
  const b = byCard.get(c);
  const files = photoIndex.get(c) || [];
  if (files.length > 1 && !photoFor(c, name)) plan.ambiguousPhoto.push({ c, files });
  if (!b) {
    // شخص موجود عندنا برقم بطاقة خطأ (بصفر زائد) في نفس العائلة وبنفس الاسم: يُنقل إلى رقمه الصحيح بدل إضافة نسخة.
    const fam = familyKeyFromCard(c);
    const ai = aliases.findIndex((a) => familyKeyFromCard(card(a.card1)) === fam && normalizeAr(a.name) === normalizeAr(name));
    if (ai >= 0) {
      const a = aliases.splice(ai, 1)[0];
      plan.reassign.push({ b: a, c, name, birth, status });
      continue;
    }
    plan.insert.push({ c, name, birth, status, photo: photoFor(c, name) });
    continue;
  }
  if (name && name !== b.name) {
    plan.rename.push({ b, from: b.name, to: name });
    // تغيّر صاحب البطاقة: الصورة تتبع الاسم لا الرقم.
    // صاحب مختلف = الاسم الأول تغيّر (اسم أطول لنفس الشخص لا ينقل الصورة).
    const firstName = (n) => normalizeAr(n).split(' ')[0];
    if (firstName(name) !== firstName(b.name) && b.photo_file && nameInFile(b.photo_file) !== normalizeAr(name)) {
      const right = familyPhotoByName(c, name);
      if (right) plan.photoFix.push({ b, from: b.photo_file, to: right });
      else if (nameInFile(b.photo_file) === normalizeAr(b.name)) plan.photoUnlink.push({ b, from: b.photo_file });
    }
  }
  if (birth && birth !== b.dob) plan.dob.push({ b, from: b.dob, to: birth });
  if (status !== (b.legacy_status || '')) plan.status.push({ b, from: b.legacy_status, to: status });
  const pf = photoFor(c, name);
  if (!b.photo_file && pf) plan.photoLink.push({ b, to: pf });
  // صورة مربوطة لكن اسم ملفها لبطاقة أخرى، ويوجد ملف صحيح لهذه البطاقة.
  const own = /(JMR2025[A-Z0-9]+)\.webp$/i.exec(b.photo_file || '');
  if (b.photo_file && own && card(own[1]) !== c && pf) plan.photoFix.push({ b, from: b.photo_file, to: pf });
}
// البدائل الباقية: نسخة مكررة لصاحب الرقم الصحيح ← حذف ناعم؛ شخص مستبعد ← حذف ناعم بسبب الاستبعاد؛ غير ذلك ← للمراجعة.
for (const a of aliases) {
  const main = byCard.get(card(a.card1));
  if (main && normalizeAr(main.name) === normalizeAr(a.name)) plan.dupDelete.push({ b: a, main });
  else if (excludedNames.has(normalizeAr(a.name))) plan.exclude.push({ b: a });
  else plan.aliasUnknown.push({ b: a, main });
}
const notInList = rows.filter((r) => !listCards.has(card(r.card1 || r.card2)));

const summary = {
  'سجلات القائمة': list.length,
  'تصحيح اسم': plan.rename.length,
  'تصحيح/إضافة مواليد': plan.dob.length,
  'تحديث حالة المستفيد': plan.status.length,
  'ربط صورة لمن بلا صورة': plan.photoLink.length,
  'تصحيح صورة مربوطة بشخص آخر': plan.photoFix.length,
  'فك صورة الشخص السابق عن البطاقة': plan.photoUnlink.length,
  'إضافة مستفيد جديد': plan.insert.length,
  '  منهم بصورة': plan.insert.filter((x) => x.photo).length,
  'نقل إلى رقم البطاقة الصحيح (كان بصفر زائد)': plan.reassign.length,
  'حذف نسخة مكررة (نفس الشخص برقم بصفر زائد)': plan.dupDelete.length,
  'حذف مستبعد (ليس في قائمة الجهة)': plan.exclude.length,
  'رقم بصفر زائد لشخص آخر (للمراجعة)': plan.aliasUnknown.length,
  'أكثر من صورة لنفس البطاقة (لم تُربط)': plan.ambiguousPhoto.length,
  'في المنظومة وليسوا في القائمة (لا تغيير)': notInList.length,
};
console.table(summary);
for (const [k, v] of [['أمثلة تصحيح الاسم', plan.rename], ['أمثلة الحالة', plan.status]]) {
  if (k.includes('الاسم')) { console.log(k + ':'); for (const x of v) console.log('   ' + x.b.card1 + ': ' + x.from + ' ← ' + x.to); continue; }
  console.log(k + ':', v.slice(0, 4).map((x) => `${x.b.card1}: ${x.from || '—'} ← ${x.to}`).join(' | '));
}
console.log('النقل:', plan.reassign.map((x) => `${x.b.card1} ${x.b.name} ← ${x.c}`).join(' | '));
console.log('المستبعدون:', plan.exclude.map((x) => `${x.b.card1} ${x.b.name}`).join(' | '));
console.log('للمراجعة:', plan.aliasUnknown.map((x) => `${x.b.card1} ${x.b.name} (الرقم الصحيح لـ ${x.main?.name || '—'})`).join(' | '));
console.log('تصحيح الصور:', [...plan.photoFix.map((x) => `${x.b.card1}: ${x.from} ← ${x.to}`), ...plan.photoUnlink.map((x) => `${x.b.card1}: فك ${x.from}`)].join(' | '));
console.log('صور غامضة:', plan.ambiguousPhoto.map((x) => `${x.c}: ${x.files.join(' + ')}`).join(' | '));

if (!apply) {
  console.log('\nتقرير فقط. للتنفيذ أضف --apply');
  process.exit(0);
}

// نسخة احتياطية قبل الكتابة.
const backupDir = path.join(DATA_DIR, 'backups');
fs.mkdirSync(backupDir, { recursive: true });
const backup = path.join(backupDir, `before-customs-${Date.now()}.db`);
db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
console.log('نسخة احتياطية: ' + backup);

const at = nowIso();
const ev = db.prepare('INSERT INTO beneficiary_events (beneficiary_id, action, field, old_value, new_value, reason, actor, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const touched = new Map();
const touch = (b) => {
  if (!touched.has(b.id)) touched.set(b.id, { ...b });
  return touched.get(b.id);
};
tx(db, () => {
  for (const x of plan.rename) { touch(x.b).name = x.to; ev.run(x.b.id, 'list_sync', 'name', x.from, x.to, 'القائمة الموحدة', ACTOR, at); }
  for (const x of plan.dob) { touch(x.b).dob = x.to; ev.run(x.b.id, 'list_sync', 'dob', x.from || '', x.to, 'القائمة الموحدة', ACTOR, at); }
  for (const x of plan.status) { touch(x.b).legacy_status = x.to; ev.run(x.b.id, 'list_sync', 'legacy_status', x.from || '', x.to, 'حالة المستفيد من منظومة الأسنان', ACTOR, at); }
  for (const x of [...plan.photoLink, ...plan.photoFix]) {
    touch(x.b).photo_file = x.to;
    ev.run(x.b.id, 'photo', 'photo_file', x.b.photo_file || '', x.to, 'ربط الصورة برقم البطاقة', ACTOR, at);
  }
  for (const x of plan.reassign) {
    const t = touch(x.b);
    ev.run(x.b.id, 'list_sync', 'card1', x.b.card1, x.c, 'تصحيح رقم البطاقة (صفر زائد)', ACTOR, at);
    if (x.birth && x.birth !== x.b.dob) ev.run(x.b.id, 'list_sync', 'dob', x.b.dob || '', x.birth, 'القائمة الموحدة', ACTOR, at);
    Object.assign(t, { card1: x.c, family_key: familyKeyFromCard(x.c), name: x.name, dob: x.birth || x.b.dob, legacy_status: x.status });
  }
  const del = db.prepare("UPDATE beneficiaries SET deleted = 1, version = version + 1, updated_at = ? WHERE id = ?");
  for (const x of plan.dupDelete) { del.run(at, x.b.id); ev.run(x.b.id, 'delete', 'deleted', '0', '1', `نسخة مكررة من ${x.main.card1}`, ACTOR, at); }
  for (const x of plan.exclude) { del.run(at, x.b.id); ev.run(x.b.id, 'delete', 'deleted', '0', '1', 'مستبعد: ليس في قائمة الجهة لعائلته', ACTOR, at); }
  for (const x of plan.photoUnlink) { touch(x.b).photo_file = null; ev.run(x.b.id, 'photo', 'photo_file', x.from, '', 'الصورة لصاحب البطاقة السابق', ACTOR, at); }
  const upd0 = db.prepare('UPDATE beneficiaries SET card1 = ?, family_key = ? WHERE id = ?');
  for (const x of plan.reassign) upd0.run(touched.get(x.b.id).card1, touched.get(x.b.id).family_key, x.b.id);
  const upd = db.prepare('UPDATE beneficiaries SET name = ?, dob = ?, legacy_status = ?, photo_file = ?, search_key = ?, version = version + 1, updated_at = ? WHERE id = ?');
  for (const b of touched.values()) upd.run(b.name, b.dob, b.legacy_status, b.photo_file, buildSearchKey(b), at, b.id);

  let nextId = db.prepare('SELECT MAX(id) m FROM beneficiaries').get().m;
  const ins = db.prepare(
    `INSERT INTO beneficiaries (id, entity_id, family_key, job_no, employee_name, name, relation, dob, card1, photo_file, legacy_status, search_key, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const principalName = (fk) => db.prepare('SELECT name, relation FROM beneficiaries WHERE entity_id = ? AND family_key = ? AND deleted = 0').all(ENTITY, fk).find((r) => isPrincipal(r.relation))?.name || null;
  for (const x of plan.insert) {
    const fk = familyKeyFromCard(x.c) || `card:${x.c}`;
    const rel = relationOf(x.c);
    const row = {
      id: ++nextId, entity_id: ENTITY, family_key: fk, job_no: /^\d+$/.test(fk) ? fk : null,
      employee_name: isPrincipal(rel) ? x.name : principalName(fk), name: x.name, relation: rel,
      dob: x.birth || null, card1: x.c, photo_file: x.photo, legacy_status: x.status,
    };
    row.search_key = buildSearchKey(row);
    ins.run(row.id, row.entity_id, row.family_key, row.job_no, row.employee_name, row.name, row.relation, row.dob, row.card1, row.photo_file, row.legacy_status, row.search_key, at);
    ev.run(row.id, 'add', null, null, null, 'من القائمة الموحدة', ACTOR, at);
  }
});
console.log(`تم: تعديل ${touched.size} سجلًا، وإضافة ${plan.insert.length}.`);
