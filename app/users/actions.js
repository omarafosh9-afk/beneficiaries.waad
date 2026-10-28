'use server';

import { requireUser } from '../../lib/auth.js';
import { createUser, updateUser, setPassword, setActive, deleteUser, listUsers } from '../../lib/users.js';

// كل عمليات المستخدمين لإدارة TPA فقط.
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

export async function updateUserAction(id, input) {
  return guard(async (me) => {
    await updateUser(id, input, me.id);
    return {};
  });
}

export async function setPasswordAction(id, password) {
  return guard(async () => ({ created: await setPassword(id, password) }));
}

export async function setActiveAction(id, active) {
  return guard(async (me) => {
    await setActive(id, active, me.id);
    return {};
  });
}

export async function deleteUserAction(id) {
  return guard(async (me) => {
    await deleteUser(id, me.id);
    return {};
  });
}
