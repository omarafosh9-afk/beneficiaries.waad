'use client';

import { useActionState } from 'react';
import { login } from './actions';

export default function LoginForm({ next }) {
  const [state, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#344054]">
        اسم المستخدم
        <input name="username" autoComplete="username" required dir="ltr"
          className="h-11 px-3 border border-[#D5DCE6] rounded-lg font-normal text-right" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#344054]">
        كلمة المرور
        <input name="password" type="password" autoComplete="current-password" required dir="ltr"
          className="h-11 px-3 border border-[#D5DCE6] rounded-lg font-normal text-right" />
      </label>
      {state?.error && <p role="alert" className="text-sm font-semibold text-[#B42318]">{state.error}</p>}
      <button type="submit" disabled={pending}
        className="h-11 rounded-lg bg-[#1D4ED8] hover:bg-[#1E40AF] text-white font-semibold disabled:opacity-50">
        {pending ? 'جارٍ الدخول…' : 'دخول'}
      </button>
    </form>
  );
}
