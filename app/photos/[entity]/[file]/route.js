// يقدّم صور المستفيدين من STORAGE_DIR بعد التحقق من الصلاحية:
// مستخدم الجهة يرى صور جهته فقط، وإدارة TPA ترى الكل.
import fs from 'node:fs';
import path from 'node:path';
import { STORAGE_DIR } from '../../../../lib/db.js';
import { ENTITY_IDS } from '../../../../lib/derive.js';
import { currentUser } from '../../../../lib/auth.js';

export async function GET(request, { params }) {
  const { entity, file } = await params;
  const user = await currentUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const entityId = ENTITY_IDS[entity];
  const name = decodeURIComponent(file);
  if (!entityId || name.includes('/') || name.includes('\\') || name.includes('..') || !/\.webp$/i.test(name)) {
    return new Response('Not found', { status: 404 });
  }
  if (user.role === 'entity' && user.entityId !== entityId) return new Response('Forbidden', { status: 403 });
  const full = path.join(STORAGE_DIR, entity, name);
  if (!fs.existsSync(full)) return new Response('Not found', { status: 404 });
  return new Response(fs.readFileSync(full), {
    headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=300' },
  });
}
