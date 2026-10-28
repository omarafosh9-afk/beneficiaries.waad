'use server';

import { requireUser, startSession } from '../../lib/auth.js';
import { changeOwnPassword } from '../../lib/users.js';

export async function changePasswordAction(prevState, formData) {
  try {
    const me = await requireUser(['tpa', 'entity', 'printer']);
    if (formData.get('next') !== formData.get('confirm')) return { error: 'كلمتا المرور الجديدتان غير متطابقتين.' };
    await startSession(me.id, await changeOwnPassword(me.id, formData.get('current'), formData.get('next')));
    return { ok: true };
  } catch (e) {
    return { error: e.message || 'حدث خطأ غير متوقع.' };
  }
}
