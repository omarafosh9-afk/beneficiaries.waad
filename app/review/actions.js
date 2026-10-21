'use server';

import { requireUser, scopeEntity, actorName } from '../../lib/auth.js';
import { ENTITY_CODES, parseDob } from '../../lib/derive.js';
import { preparePhoto, writePhoto } from '../../lib/photos.js';
import { onCloudflare } from '../../lib/db.js';
import {
  approve, previewApproval, editBeneficiary, getBeneficiary, returnForEdit, previewForward, forward,
} from '../../lib/beneficiaries.js';

// target: { ids } أو { filter } (الفلتر نفسه المعروض، لتحديد «كل المطابق»).
function scopedTarget(user, target) {
  if (target?.filter) return { filter: { ...target.filter, entityId: scopeEntity(user, target.filter.entityId) } };
  return { ids: target?.ids || [] };
}

async function guard(roles, fn) {
  try {
    const user = await requireUser(roles);
    return { ok: true, ...(await fn(user)) };
  } catch (e) {
    return { ok: false, error: e.message || 'حدث خطأ غير متوقع.' };
  }
}

const entityScope = (u) => (u.role === 'entity' ? u.entityId : null);

export async function previewApprovalAction(target) {
  return guard(['tpa', 'entity'], async (u) => ({ counts: await previewApproval(scopedTarget(u, target), entityScope(u)) }));
}

export async function approveAction(target) {
  return guard(['tpa', 'entity'], async (u) => ({ result: await approve(scopedTarget(u, target), actorName(u), entityScope(u)) }));
}

// على Cloudflare تُحفظ الصورة كما هي (بلا تصغير)، لذلك حدّها أصغر هناك.
const MAX_PHOTO = () => (onCloudflare() ? 1024 * 1024 : 10 * 1024 * 1024);

export async function editAction(formData) {
  return guard(['tpa', 'entity'], async (u) => {
    const id = Number(formData.get('id'));
    const b = await getBeneficiary(id);
    if (!b || (u.role === 'entity' && b.entity_id !== u.entityId)) throw new Error('السجل غير موجود.');
    const dob = parseDob(formData.get('dob'));
    if (dob === null) throw new Error('صيغة المواليد غير صحيحة (مثال: 2014/11/05 أو 1952).');

    let photo = null;
    const file = formData.get('photo');
    if (file && typeof file !== 'string' && file.size) {
      if (file.size > MAX_PHOTO()) throw new Error(`حجم الصورة أكبر من ${onCloudflare() ? '1' : '10'} ميغابايت.`);
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('الصورة يجب أن تكون JPG أو PNG أو WebP.');
      photo = (await preparePhoto(new Uint8Array(await file.arrayBuffer()))).bytes;
    }
    // الملف يُكتب أولا باسم جديد، ثم يُسجَّل في القاعدة؛ لو فشل التسجيل يبقى الملف القديم مستخدما.
    const photoFile = photo ? `${id}-${Date.now()}.webp` : null;
    if (photo) await writePhoto(ENTITY_CODES[b.entity_id], photoFile, photo);
    const view = await editBeneficiary(
      {
        id,
        version: formData.get('version'),
        name: formData.get('name'),
        relation: formData.get('relation'),
        dob,
        reason: formData.get('reason'),
        photoFile,
      },
      actorName(u),
      entityScope(u)
    );
    return { view };
  });
}

// ---------- عمليات شركة TPA ----------

export async function returnAction(id, note) {
  return guard(['tpa'], async (u) => ({ done: await returnForEdit(id, note, actorName(u)) }));
}

export async function previewForwardAction(target) {
  return guard(['tpa'], async (u) => ({ preview: await previewForward(scopedTarget(u, target)) }));
}

export async function forwardAction(target) {
  return guard(['tpa'], async (u) => ({ batches: await forward(scopedTarget(u, target), actorName(u)) }));
}
