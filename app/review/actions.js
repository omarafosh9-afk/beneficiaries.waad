'use server';

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { requireUser, scopeEntity, actorName } from '../../lib/auth.js';
import { STORAGE_DIR } from '../../lib/db.js';
import { ENTITY_CODES, parseDob } from '../../lib/derive.js';
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

export async function previewApprovalAction(target) {
  return guard(['tpa', 'entity'], async (u) => ({
    counts: previewApproval(scopedTarget(u, target), u.role === 'entity' ? u.entityId : null),
  }));
}

export async function approveAction(target) {
  return guard(['tpa', 'entity'], async (u) => ({
    result: approve(scopedTarget(u, target), actorName(u), u.role === 'entity' ? u.entityId : null),
  }));
}

const MAX_PHOTO = 10 * 1024 * 1024;

export async function editAction(formData) {
  return guard(['tpa', 'entity'], async (u) => {
    const id = Number(formData.get('id'));
    const b = getBeneficiary(id);
    if (!b || (u.role === 'entity' && b.entity_id !== u.entityId)) throw new Error('السجل غير موجود.');
    const dob = parseDob(formData.get('dob'));
    if (dob === null) throw new Error('صيغة المواليد غير صحيحة (مثال: 2014/11/05 أو 1952).');

    let photoFile = null;
    let tmp = null;
    const file = formData.get('photo');
    if (file && typeof file !== 'string' && file.size) {
      if (file.size > MAX_PHOTO) throw new Error('حجم الصورة أكبر من 10 ميغابايت.');
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('الصورة يجب أن تكون JPG أو PNG أو WebP.');
      const dir = path.join(STORAGE_DIR, ENTITY_CODES[b.entity_id]);
      fs.mkdirSync(dir, { recursive: true });
      photoFile = `${id}.webp`;
      tmp = path.join(dir, `${id}.${Date.now()}.tmp.webp`);
      await sharp(Buffer.from(await file.arrayBuffer()))
        .rotate()
        .resize(500, 500, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 78 })
        .toFile(tmp);
    }
    try {
      const view = editBeneficiary(
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
        u.role === 'entity' ? u.entityId : null
      );
      if (tmp) fs.renameSync(tmp, path.join(path.dirname(tmp), photoFile));
      return { view };
    } catch (e) {
      if (tmp) fs.rmSync(tmp, { force: true });
      throw e;
    }
  });
}

// ---------- عمليات شركة TPA ----------

export async function returnAction(id, note) {
  return guard(['tpa'], async (u) => ({ done: returnForEdit(id, note, actorName(u)) }));
}

export async function previewForwardAction(target) {
  return guard(['tpa'], async (u) => ({ preview: previewForward(scopedTarget(u, target)) }));
}

export async function forwardAction(target) {
  return guard(['tpa'], async (u) => ({ batches: forward(scopedTarget(u, target), actorName(u)) }));
}
