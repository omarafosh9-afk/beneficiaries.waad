// استيراد صور من ملف مضغوط: رقم الصورة في اسم الملف (15.jpg أو 0015 - اسم.jpg) = التسلسل في قاعدة البيانات.
// المفتاح إما التسلسل داخل دفعة معيّنة (list_serial) أو التسلسل العام في الجهة (seq).
// يعمل في الخلفية؛ الحالة تُحفظ في الذاكرة ويسأل عنها المتصفح دوريًا.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './db-node.js';
import { getDb, nowIso } from './db.js';
import { openZip } from './zip-read.js';
import { preparePhoto, writePhoto } from './photos.js';
import { ENTITY_CODES, ENTITY_NAMES } from './derive.js';
import { UserError } from './beneficiaries.js';

export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const MAX_UPLOAD = 4 * 1024 ** 3;
const IMAGE = /\.(jpe?g|png|webp|tiff?|bmp)$/i;

const jobs = (globalThis.__photoJobs ??= new Map());

export function uploadPath(id) {
  if (!/^[a-f0-9]{32}$/.test(String(id))) throw new UserError('معرّف رفع غير صالح.');
  return path.join(UPLOAD_DIR, `${id}.zip`);
}

// رقم الصورة: أول رقم في اسم الملف (بعد إزالة المجلدات والامتداد).
export function serialOf(name) {
  const m = /\d+/.exec(path.posix.basename(name.replace(/\\/g, '/')).replace(/\.[^.]+$/, ''));
  return m ? Number(m[0]) : null;
}

// الدفعات المتاحة لكل جهة مع عدد من لديهم صورة (لنموذج الرفع).
export async function importTargets() {
  const db = await getDb();
  const rows = await db.all(
    `SELECT entity_id e, intake_batch b, COUNT(*) n, SUM(photo_file IS NOT NULL) p, MAX(list_serial) mx
     FROM beneficiaries WHERE deleted = 0 AND intake_batch IS NOT NULL AND list_serial IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2`
  );
  const seq = await db.all(`SELECT entity_id e, COUNT(*) n, SUM(photo_file IS NOT NULL) p, MAX(seq) mx FROM beneficiaries WHERE deleted = 0 AND seq IS NOT NULL GROUP BY 1`);
  return Object.keys(ENTITY_NAMES).map(Number).map((e) => ({
    id: e,
    name: ENTITY_NAMES[e],
    batches: rows.filter((r) => r.e === e).map((r) => ({ batch: r.b, count: r.n, withPhoto: r.p, max: r.mx })),
    seq: seq.filter((r) => r.e === e).map((r) => ({ count: r.n, withPhoto: r.p, max: r.mx }))[0] || null,
  })).filter((x) => x.batches.length || x.seq);
}

export function jobStatus(id) {
  const j = jobs.get(String(id));
  if (!j) throw new UserError('عملية الاستيراد غير موجودة (ربما أُعيد تشغيل الخادم).');
  return j;
}

export async function startImport({ uploadId, entityId, mode, batch, replace }, actor) {
  const file = uploadPath(uploadId);
  if (!fs.existsSync(file)) throw new UserError('لم يكتمل رفع الملف.');
  const entity = Number(entityId);
  if (!ENTITY_CODES[entity]) throw new UserError('اختر جهة العمل.');
  if (mode !== 'seq' && mode !== 'batch') throw new UserError('اختر طريقة الربط.');
  if (mode === 'batch' && !(Number(batch) > 0)) throw new UserError('اختر الدفعة.');

  let zip;
  try {
    zip = openZip(file);
  } catch (e) {
    fs.rmSync(file, { force: true });
    throw new UserError(e.message);
  }
  const id = crypto.randomBytes(8).toString('hex');
  const job = {
    id, state: 'running', startedAt: nowIso(), total: 0, done: 0,
    target: mode === 'seq' ? `${ENTITY_NAMES[entity]} · التسلسل العام` : `${ENTITY_NAMES[entity]} · الدفعة ${batch}`,
    added: 0, replaced: 0, keptExisting: [], notFound: [], duplicates: [], noNumber: [], failed: [], ignored: 0, error: null,
  };
  jobs.set(id, job);
  run(job, zip, file, { entity, mode, batch: Number(batch), replace: !!replace, actor }).catch((e) => {
    job.state = 'failed';
    job.error = e.message;
  });
  return id;
}

async function run(job, zip, file, { entity, mode, batch, replace, actor }) {
  try {
    const db = await getDb();
    const col = mode === 'seq' ? 'seq' : 'list_serial';
    const rows = await db.all(
      `SELECT id, name, photo_file, ${col} k FROM beneficiaries WHERE entity_id = ? AND deleted = 0 AND ${col} IS NOT NULL ${mode === 'batch' ? 'AND intake_batch = ?' : ''}`,
      mode === 'batch' ? [entity, batch] : [entity]
    );
    const byKey = new Map(rows.map((r) => [r.k, r]));

    const images = [];
    for (const e of zip.entries) {
      if (e.dir) continue;
      const base = path.posix.basename(e.name.replace(/\\/g, '/'));
      if (base.startsWith('.') || e.name.includes('__MACOSX')) continue;
      if (!IMAGE.test(base)) { job.ignored++; continue; }
      images.push({ e, base, key: serialOf(e.name) });
    }
    job.total = images.length;

    const seen = new Map();
    for (const img of images) {
      if (img.key === null) job.noNumber.push(img.base);
      else if (seen.has(img.key)) job.duplicates.push(`${img.key}: ${seen.get(img.key)} و ${img.base}`);
      else seen.set(img.key, img.base);
    }

    const at = nowIso();
    const code = ENTITY_CODES[entity];
    for (const img of images) {
      try {
        if (img.key === null || seen.get(img.key) !== img.base) continue;
        const b = byKey.get(img.key);
        if (!b) { job.notFound.push(img.base); continue; }
        if (b.photo_file && !replace) { job.keptExisting.push(img.key); continue; }
        const { bytes } = await preparePhoto(zip.read(img.e));
        const photoFile = `${b.id}-${Date.now()}.webp`;
        await writePhoto(code, photoFile, bytes);
        await db.batch([
          ['UPDATE beneficiaries SET photo_file = ?, version = version + 1, updated_at = ? WHERE id = ?', [photoFile, at, b.id]],
          [`INSERT INTO beneficiary_events (beneficiary_id, action, field, old_value, new_value, reason, actor, at) VALUES (?, 'photo', 'photo_file', ?, ?, ?, ?, ?)`,
            [b.id, b.photo_file || '', photoFile, `ملف مضغوط: ${img.base}`, actor, at]],
        ]);
        if (b.photo_file) job.replaced++;
        else job.added++;
      } catch (e) {
        job.failed.push(`${img.base}: ${e.message}`);
      } finally {
        job.done++;
      }
    }
    job.stillWithoutPhoto = (await db.get(
      `SELECT COUNT(*) n FROM beneficiaries WHERE entity_id = ? AND deleted = 0 AND photo_file IS NULL AND ${col} IS NOT NULL ${mode === 'batch' ? 'AND intake_batch = ?' : ''}`,
      mode === 'batch' ? [entity, batch] : [entity]
    )).n;
    job.state = 'done';
  } finally {
    zip.close();
    fs.rmSync(file, { force: true });
  }
}
