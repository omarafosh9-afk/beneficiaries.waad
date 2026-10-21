// تخزين الصور: مجلد STORAGE_DIR محليًا، وKV (المفتاح <code>/<file>) على Cloudflare.
import path from 'node:path';
import { onCloudflare, cfEnv } from './db.js';

export const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), 'public', 'storage'));

function safe(code, file) {
  return code && file && !/[\\/]|\.\./.test(file) && !/[\\/]|\.\./.test(code);
}

export async function readPhoto(code, file) {
  if (!safe(code, file)) return null;
  if (onCloudflare()) {
    const buf = await (await cfEnv()).PHOTOS.get(`${code}/${file}`, 'arrayBuffer');
    return buf ? new Uint8Array(buf) : null;
  }
  const fs = await import('node:fs');
  const full = path.join(STORAGE_DIR, code, file);
  return fs.existsSync(full) ? fs.readFileSync(full) : null;
}

export async function writePhoto(code, file, bytes) {
  if (!safe(code, file)) throw new Error('اسم ملف غير صالح');
  if (onCloudflare()) {
    await (await cfEnv()).PHOTOS.put(`${code}/${file}`, bytes);
    return;
  }
  const fs = await import('node:fs');
  const dir = path.join(STORAGE_DIR, code);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), bytes);
}

// يصغّر الصورة إلى WebP بعرض 500 محليًا. على Cloudflare لا توجد sharp، فتُحفظ كما هي
// (لذلك يُشترط هناك حجم صغير ونوع WebP/JPEG/PNG).
export async function preparePhoto(bytes) {
  if (onCloudflare()) return { bytes, ext: 'img' };
  const sharp = (await import('sharp')).default;
  const out = await sharp(Buffer.from(bytes)).rotate().resize(500, 500, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  return { bytes: out, ext: 'webp' };
}
