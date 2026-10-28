'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '../../lib/db.js';
import { checkPassword, SESSION_COOKIE } from '../../lib/session.js';
import { startSession } from '../../lib/auth.js';

const HOME = { tpa: '/tpa', entity: '/review', printer: '/printer' };

export async function login(prevState, formData) {
  const username = String(formData.get('username') || '').trim();
  const password = String(formData.get('password') || '');
  const u = await (await getDb()).get('SELECT id, role, password_hash FROM users WHERE username = ? AND active = 1', [username]);
  if (!u || !checkPassword(password, u.password_hash)) {
    return { error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' };
  }
  await startSession(u.id, u.password_hash);
  const next = String(formData.get('next') || '');
  redirect(next.startsWith('/') && !next.startsWith('//') ? next : HOME[u.role] || '/review');
}

export async function logout() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect('/login');
}
