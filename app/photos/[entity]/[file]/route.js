// يقدّم صور المستفيدين بعد التحقق من الصلاحية: مستخدم الجهة يرى صور جهته فقط، وإدارة TPA ترى الكل.
// المصدر: مجلد STORAGE_DIR محليًا، أو KV على Cloudflare.
import { ENTITY_IDS } from '../../../../lib/derive.js';
import { currentUser } from '../../../../lib/auth.js';
import { readPhoto } from '../../../../lib/photos.js';

function contentType(b) {
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  return 'image/webp';
}

export async function GET(request, { params }) {
  const { entity, file } = await params;
  const user = await currentUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const entityId = ENTITY_IDS[entity];
  const name = decodeURIComponent(file);
  if (!entityId || !/\.webp$/i.test(name)) return new Response('Not found', { status: 404 });
  if (user.role === 'entity' && user.entityId !== entityId) return new Response('Forbidden', { status: 403 });
  const bytes = await readPhoto(entity, name);
  if (!bytes) return new Response('Not found', { status: 404 });
  return new Response(bytes, { headers: { 'Content-Type': contentType(bytes), 'Cache-Control': 'private, max-age=300' } });
}
