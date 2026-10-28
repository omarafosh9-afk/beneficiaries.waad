'use client';

import { useActionState } from 'react';
import { changePasswordAction } from './actions';

const input = 'h-11 px-3 border border-[#D5DCE6] rounded-lg font-normal text-right';

export default function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, null);
  return (
    <form action={action} key={state?.ok ? 'done' : 'form'} className="flex flex-col gap-4">
      {[['current', 'كلمة المرور الحالية', 'current-password'], ['next', 'كلمة المرور الجديدة', 'new-password'], ['confirm', 'تأكيد كلمة المرور الجديدة', 'new-password']].map(([name, label, ac]) => (
        <label key={name} className="flex flex-col gap-1.5 text-sm font-semibold text-[#344054]">
          {label}
          <input name={name} type="password" autoComplete={ac} required minLength={name === 'current' ? 1 : 4} maxLength={64} dir="ltr" className={input} />
        </label>
      ))}
      <p className="m-0 text-[13px] text-[#5B6475]">4 أحرف أو أرقام على الأقل.</p>
      {state?.error && <p role="alert" className="m-0 text-sm font-semibold text-[#B42318]">{state.error}</p>}
      {state?.ok && <p role="status" className="m-0 text-sm font-semibold text-[#126B33]">تم تغيير كلمة المرور.</p>}
      <button type="submit" disabled={pending}
        className="h-11 rounded-lg bg-[#1D4ED8] hover:bg-[#1E40AF] text-white font-semibold disabled:opacity-50">
        {pending ? 'جارٍ الحفظ…' : 'حفظ كلمة المرور'}
      </button>
    </form>
  );
}
