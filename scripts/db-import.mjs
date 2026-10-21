// ينشئ قاعدة البيانات من data/people.json (ترحيل لمرة واحدة).
// يرفض العمل إن كانت القاعدة فيها بيانات، إلا مع --force (يمسح القاعدة ويعيد البناء).
// الاستخدام: npm run db:import [-- --force] [-- --source path/to/people.json]
import fs from 'node:fs';
import path from 'node:path';
import { openDb, tx, nowIso, DATA_DIR, DB_PATH } from '../lib/db-node.js';
import { STORAGE_DIR } from '../lib/photos.js';
import { deriveRows, ENTITY_CODES } from '../lib/derive.js';

const args = process.argv.slice(2);
const force = args.includes('--force');
const srcIdx = args.indexOf('--source');
const source = srcIdx >= 0 ? path.resolve(args[srcIdx + 1]) : path.join(DATA_DIR, 'people.json');

if (!fs.existsSync(source)) {
  console.error('لم يُعثر على ملف المصدر: ' + source);
  process.exit(1);
}
if (fs.existsSync(DB_PATH)) {
  const db0 = openDb();
  const n = db0.prepare('SELECT COUNT(*) n FROM beneficiaries').get().n;
  db0.close();
  if (n > 0 && !force) {
    console.error(`القاعدة ${DB_PATH} فيها ${n} سجلًا. استخدم --force لإعادة البناء (يمسح أي مراجعات تمت).`);
    process.exit(1);
  }
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) fs.rmSync(f, { force: true });
}

const people = JSON.parse(fs.readFileSync(source, 'utf-8'));
const rows = deriveRows(people);
const slugs = new Map(people.map((p) => [p.id, p.photoSlug]));
const db = openDb();
const at = nowIso();
const stats = {};

tx(db, () => {
  const ins = db.prepare(
    `INSERT INTO beneficiaries (id, entity_id, family_key, job_no, employee_name, name, relation, dob, national_id, card1, card2,
     photo_file, intake_batch, legacy_status, deleted, search_key, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  const ev = db.prepare(`INSERT INTO beneficiary_events (beneficiary_id, action, actor, at) VALUES (?, 'import', 'الترحيل', ?)`);
  for (const r of rows) {
    const code = ENTITY_CODES[r.entity_id];
    const slug = slugs.get(r.id);
    const file = slug && fs.existsSync(path.join(STORAGE_DIR, code, `${slug}.webp`)) ? `${slug}.webp` : null;
    ins.run(r.id, r.entity_id, r.family_key, r.job_no, r.employee_name, r.name, r.relation, r.dob, r.national_id,
      r.card1, r.card2, file, r.intake_batch, r.legacy_status, r.deleted, r.search_key, at);
    ev.run(r.id, at);
    const s = (stats[code] ??= { active: 0, deleted: 0, photos: 0, intake: 0, noJob: 0 });
    if (r.deleted) s.deleted++;
    else {
      s.active++;
      if (file) s.photos++;
      if (r.intake_batch) s.intake++;
      if (!r.job_no) s.noJob++;
    }
  }
});

console.log('تم إنشاء القاعدة: ' + DB_PATH);
console.table(stats);
db.close();
