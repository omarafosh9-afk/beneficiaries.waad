'use client';

import { useState } from 'react';
import { createUserAction, resetPasswordAction, setActiveAction } from './actions';
import { btn, Dialog, Icon } from '../review/ui';

const ENTITIES = [
  { id: 1, name: 'الاسمنت' },
  { id: 2, name: 'جليانة' },
  { id: 3, name: 'الجمارك' },
];
const ROLE_AR = { tpa: 'شركة TPA', entity: 'جهة عمل', printer: 'المطبعة' };
const input = 'h-11 px-3 border border-[#D5DCE6] rounded-[10px] bg-white font-normal';

export default function UsersClient({ initialUsers, meId }) {
  const [users, setUsers] = useState(initialUsers);
  const [form, setForm] = useState({ username: '', displayName: '', role: 'entity', entityId: 2 });
  const [error, setError] = useState('');
  const [shown, setShown] = useState(null); // {username, password, title}
  const [busy, setBusy] = useState(false);

  const apply = (r, title) => {
    if (!r.ok) return setError(r.error);
    setError('');
    setUsers(r.users);
    if (r.created) setShown({ ...r.created, title });
  };

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    const r = await createUserAction(form);
    setBusy(false);
    apply(r, 'تم إنشاء المستخدم');
    if (r.ok) setForm({ ...form, username: '', displayName: '' });
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={add} className="bg-white border border-[#E3E8EF] rounded-2xl p-5 flex flex-col gap-4">
        <h2 className="m-0 text-base font-bold">إضافة مستخدم</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 text-xs font-semibold text-[#344054] w-48">
            اسم المستخدم (للدخول)
            <input dir="ltr" required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className={`${input} text-right`} placeholder="jalyana2" />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-semibold text-[#344054] flex-[1_1_220px]">
            الاسم الظاهر
            <input required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} className={input} placeholder="مثال: مراجع جليانة" />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-semibold text-[#344054] w-40">
            النوع
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={input}>
              <option value="entity">جهة عمل</option>
              <option value="tpa">شركة TPA</option>
            </select>
          </label>
          {form.role === 'entity' && (
            <label className="flex flex-col gap-1.5 text-xs font-semibold text-[#344054] w-40">
              الجهة
              <select value={form.entityId} onChange={(e) => setForm({ ...form, entityId: Number(e.target.value) })} className={input}>
                {ENTITIES.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
          )}
          <button type="submit" disabled={busy} className={btn.primary}><Icon name="check" strokeWidth={2.4} />إضافة</button>
        </div>
        <p className="m-0 text-[13px] text-[#5B6475]">تُنشأ كلمة مرور مؤقتة تظهر مرة واحدة؛ سلّمها للمستخدم.</p>
        {error && <p role="alert" className="m-0 text-[#B42318] font-semibold">{error}</p>}
      </form>

      <section className="bg-white border border-[#E3E8EF] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-right border-collapse">
            <thead className="bg-[#F8FAFC] text-[13px] text-[#344054]">
              <tr>
                {['اسم المستخدم', 'الاسم الظاهر', 'النوع', 'الجهة', 'الحالة', 'إجراءات'].map((h) => (
                  <th key={h} className="px-4 h-12 font-semibold border-b border-[#E3E8EF]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-[#EEF1F5]">
                  <td className="px-4 py-3 font-mono" dir="ltr" style={{ textAlign: 'right' }}>{u.username}</td>
                  <td className="px-4 py-3 font-semibold">{u.display_name}{u.id === meId && <span className="text-xs text-[#5B6475] font-normal"> (أنت)</span>}</td>
                  <td className="px-4 py-3">{ROLE_AR[u.role]}</td>
                  <td className="px-4 py-3">{u.entity || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex h-7 items-center px-2.5 rounded-full text-xs font-bold ${u.active ? 'bg-[#E7F6EC] text-[#126B33]' : 'bg-[#F2F4F7] text-[#475467]'}`}>
                      {u.active ? 'نشط' : 'موقوف'}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={btn.ghost} onClick={async () => apply(await resetPasswordAction(u.id), 'تم تصفير كلمة المرور')}>
                        <Icon name="undo" size={16} />تصفير كلمة المرور
                      </button>
                      {u.id !== meId && (
                        <button type="button" className={u.active ? btn.warn : btn.approve} onClick={async () => apply(await setActiveAction(u.id, !u.active))}>
                          {u.active ? 'إيقاف' : 'تفعيل'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {shown && (
        <Dialog title={shown.title} onClose={() => setShown(null)}>
          <p className="m-0 text-[#344054]">سلّم هذه البيانات للمستخدم. لن تظهر كلمة المرور مرة أخرى.</p>
          <div className="flex flex-col gap-2 p-4 rounded-xl bg-[#F8FAFC] border border-[#E3E8EF]">
            <span>اسم المستخدم: <b dir="ltr" className="font-mono">{shown.username}</b></span>
            <span>كلمة المرور: <b dir="ltr" className="font-mono text-lg select-all">{shown.password}</b></span>
          </div>
          <div className="flex gap-2">
            <button type="button" className={btn.primary} onClick={() => navigator.clipboard?.writeText(shown.password)}>نسخ كلمة المرور</button>
            <button type="button" className={btn.ghost} onClick={() => setShown(null)}>إغلاق</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
