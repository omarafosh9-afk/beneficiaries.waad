'use server';

import { requireUser, actorName } from '../../lib/auth.js';
import { createEntity, listEntities } from '../../lib/entities.js';
import { previewImport, applyImport } from '../../lib/beneficiary-import.js';

// إدارة الجهات والاستيراد لـ TPA فقط.
async function guard(fn) {
  try {
    const me = await requireUser(['tpa']);
    return { ok: true, ...(await fn(me)), entities: await listEntities() };
  } catch (e) {
    return { ok: false, error: e.message || 'حدث خطأ غير متوقع.' };
  }
}

async function fileBytes(formData) {
  const f = formData.get('file');
  if (!f || typeof f === 'string' || !f.size) throw new Error('اختر ملف Excel.');
  return Buffer.from(await f.arrayBuffer());
}

export async function createEntityAction(input) {
  return guard(async () => ({ created: await createEntity(input) }));
}

export async function previewImportAction(formData) {
  return guard(async () => ({ preview: await previewImport(formData.get('entityId'), await fileBytes(formData)) }));
}

export async function applyImportAction(formData) {
  return guard(async (me) => ({ result: await applyImport(formData.get('entityId'), await fileBytes(formData), actorName(me)) }));
}
