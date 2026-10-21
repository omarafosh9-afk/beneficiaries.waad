'use server';

import { requireUser } from '../../lib/auth.js';
import { createUser, resetPassword, setActive, listUsers } from '../../lib/users.js';

async function guard(fn) {
  try {
    const me = await requireUser(['tpa']);
    return { ok: true, ...(await fn(me)), users: await listUsers() };
  } catch (e) {
    return { ok: false, error: e.message || 'حدث خطأ غير متوقع.' };
  }
}

export async function createUserAction(input) {
  return guard(async () => ({ created: await createUser(input) }));
}

export async function resetPasswordAction(id) {
  return guard(async () => ({ created: await resetPassword(id) }));
}

export async function setActiveAction(id, active) {
  return guard(async (me) => {
    await setActive(id, active, me.id);
    return {};
  });
}
