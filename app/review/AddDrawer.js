'use client';
// لوحة إضافة مستفيد جديد: يأخذ التسلسل التالي لآخر تسلسل في جهته، ويُضاف بحالة «بانتظار التحقق».
import { useState } from 'react';
import { addAction } from './actions';
import { Icon, btn, RELATIONS, relLabel } from './ui';
import { maskDmy } from './EditDrawer';

export default function AddDrawer({ entities, entityId, onClose, onSaved }) {
  const [form, setForm] = useState({ entityId: entityId || '', jobNo: '', name: '', relation: 'ابن', dob: '' });
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k, fn = (v) => v) => (e) => {
    setForm({ ...form, [k]: fn(e.target.value) });
    setError('');
  };

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData();
    for (const k of Object.keys(form)) fd.set(k, form[k]);
    if (file) fd.set('photo', file);
    const r = await addAction(fd);
    setSaving(false);
    if (!r.ok) return setError(r.error);
    onSaved(r.view);
  }

  const input = 'h-10 px-3 border border-[#D5DCE6] rounded-[10px] font-normal';
  return (
    <div className="fixed inset-0 z-50 bg-[rgba(16,24,40,0.45)] flex justify-end" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="add-title"
        className="w-full max-w-[460px] h-full bg-white flex flex-col shadow-[0_0_48px_rgba(16,24,40,0.2)]">
        <div className="flex items-start justify-between gap-3 px-6 py-5 border-b border-[#EEF1F5]">
          <div className="flex flex-col gap-1 min-w-0">
            <h2 id="add-title" className="m-0 text-lg font-bold">إضافة مستفيد جديد</h2>
            <span className="text-[13px] text-[#5B6475]">يأخذ التسلسل التالي لآخر تسلسل في الجهة</span>
          </div>
          <button type="button" onClick={onClose} aria-label="إغلاق" className={`${btn.ghost} w-11 justify-center px-0 shrink-0`}><Icon name="x" size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-[18px]">
          {entities && (
            <label className="flex flex-col gap-1.5 font-semibold text-[#344054]">
              جهة العمل
              <select value={form.entityId} onChange={set('entityId')} required className={`${input} bg-white`}>
                <option value="">اختر…</option>
                {entities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
          )}
          <div className="flex items-center gap-3.5">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="صورة المستفيد" className="w-[72px] h-[88px] rounded-[10px] object-cover" />
            ) : (
              <div className="w-[72px] h-[88px] rounded-[10px] bg-[#F2F4F7] flex items-center justify-center text-[#98A2B3]"><Icon name="camera" size={22} /></div>
            )}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" id="add-photo"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setFile(f);
                setPreview(URL.createObjectURL(f));
              }} />
            <label htmlFor="add-photo" className={`${btn.ghost} cursor-pointer`}><Icon name="upload" size={16} />{file ? 'استبدال الصورة' : 'رفع صورة'}</label>
          </div>
          <label className="flex flex-col gap-1.5 font-semibold text-[#344054]">
            الرقم الوظيفي
            <input value={form.jobNo} onChange={set('jobNo', (v) => v.replace(/\D/g, ''))} required dir="ltr" inputMode="numeric" maxLength={10}
              placeholder="مثال: 33705" className={`${input} text-left`} />
          </label>
          <label className="flex flex-col gap-1.5 font-semibold text-[#344054]">
            اسم المستفيد
            <input value={form.name} onChange={set('name')} maxLength={120} required className={input} />
          </label>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))' }}>
            <label className="flex flex-col gap-1.5 font-semibold text-[#344054]">
              صلة القرابة
              <select value={form.relation} onChange={set('relation')} className={`${input} bg-white`}>
                {RELATIONS.map((r) => <option key={r} value={r}>{relLabel(r)}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 font-semibold text-[#344054]">
              المواليد
              <input value={form.dob} onChange={set('dob', maskDmy)} dir="ltr" inputMode="numeric" autoComplete="off" placeholder="dd/mm/yyyy" maxLength={10}
                className={`${input} text-left tabular-nums tracking-wide`} />
            </label>
          </div>
          <p className="m-0 text-[13px] text-[#5B6475]">أضف الموظف أولًا إن لم تكن عائلته مسجّلة، ثم أفراد عائلته بنفس الرقم الوظيفي.</p>
          {error && <p role="alert" className="m-0 text-[#B42318] font-semibold">{error}</p>}
        </div>
        <div className="flex flex-wrap gap-2 px-6 py-4 border-t border-[#EEF1F5]">
          <button type="submit" disabled={saving} className={btn.primary}><Icon name="plus" strokeWidth={2.4} />{saving ? 'جارٍ الحفظ…' : 'إضافة'}</button>
          <button type="button" onClick={onClose} className={btn.ghost}>إلغاء</button>
        </div>
      </form>
    </div>
  );
}
