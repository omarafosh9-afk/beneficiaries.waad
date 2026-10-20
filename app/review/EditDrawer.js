'use client';
// لوحة تعديل بيانات مستفيد لجهة العمل: سبب إلزامي، صورة اختيارية، رقم البطاقة للعرض فقط.
import { useRef, useState } from 'react';
import { editAction } from './actions';
import { Icon, Photo, btn, dobText, RELATIONS, relLabel } from './ui';

export default function EditDrawer({ m, onClose, onSaved }) {
  const [form, setForm] = useState({ name: m.name, relation: m.relation, dob: dobText(m.dob), reason: '' });
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);
  const set = (k) => (e) => {
    setForm({ ...form, [k]: e.target.value });
    setError('');
  };

  async function save(e) {
    e.preventDefault();
    if (!form.reason.trim()) return setError('اكتب سبب التعديل قبل الحفظ.');
    setSaving(true);
    const fd = new FormData();
    fd.set('id', m.id);
    fd.set('version', m.version);
    for (const k of ['name', 'relation', 'dob', 'reason']) fd.set(k, form[k]);
    if (file) fd.set('photo', file);
    const r = await editAction(fd);
    setSaving(false);
    if (!r.ok) return setError(r.error);
    onSaved(r.view);
  }

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(16,24,40,0.45)] flex justify-end" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="ed-title"
        className="w-full max-w-[460px] h-full bg-white flex flex-col shadow-[0_0_48px_rgba(16,24,40,0.2)]">
        <div className="flex items-start justify-between gap-3 px-6 py-5 border-b border-[#EEF1F5]">
          <div className="flex flex-col gap-1 min-w-0">
            <h2 id="ed-title" className="m-0 text-lg font-bold">تعديل بيانات مستفيد</h2>
            <span className="text-[13px] text-[#5B6475]">الرقم الوظيفي <span dir="ltr">{m.jobNo || '—'}</span> · {m.employeeName || '—'}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="إغلاق" className={`${btn.ghost} w-11 justify-center px-0 shrink-0`}><Icon name="x" size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-[18px]">
          {m.status === 'needs_edit' && m.note && (
            <div className="flex items-start gap-2 px-3.5 py-3 rounded-[10px] bg-[#FFF1E5] text-[#B54708] font-semibold">
              <Icon name="alert" size={16} className="mt-0.5" />ملاحظة TPA: {m.note}
            </div>
          )}
          <div className="flex items-center gap-3.5">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="الصورة الجديدة" className="w-[72px] h-[88px] rounded-[10px] object-cover" />
            ) : (
              <Photo m={m} size="md" />
            )}
            <div className="flex flex-col items-start gap-1.5">
              <span className="text-[13px] text-[#5B6475]">{file ? 'تم اختيار صورة جديدة' : m.photoUrl ? 'الصورة الحالية' : 'لا توجد صورة لهذا المستفيد'}</span>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" id="ed-photo"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setFile(f);
                  setPreview(URL.createObjectURL(f));
                  setError('');
                }} />
              <label htmlFor="ed-photo" className={`${btn.ghost} cursor-pointer`}><Icon name="upload" size={16} />{m.photoUrl || file ? 'استبدال الصورة' : 'رفع صورة'}</label>
            </div>
          </div>
          <label className="flex flex-col gap-1.5 font-semibold text-[#344054]">
            اسم المستفيد
            <input value={form.name} onChange={set('name')} maxLength={120} required className="h-10 px-3 border border-[#D5DCE6] rounded-[10px] font-normal" />
          </label>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))' }}>
            <label className="flex flex-col gap-1.5 font-semibold text-[#344054]">
              صلة القرابة
              <select value={form.relation} onChange={set('relation')} className="h-10 px-3 border border-[#D5DCE6] rounded-[10px] bg-white font-normal">
                {RELATIONS.map((r) => <option key={r} value={r}>{relLabel(r)}</option>)}
                {!RELATIONS.includes(m.relation) && <option value={m.relation}>{m.relation || '—'}</option>}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 font-semibold text-[#344054]">
              المواليد
              <input value={form.dob} onChange={set('dob')} dir="ltr" placeholder="مثال: 2014/11/05" className="h-10 px-3 border border-[#D5DCE6] rounded-[10px] font-normal text-right" />
            </label>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="font-semibold text-[#344054]">رقم البطاقة</span>
            <div className="flex flex-wrap items-center justify-between gap-2 min-h-10 px-3 border border-dashed border-[#D5DCE6] rounded-[10px] bg-[#F8FAFC] text-[#5B6475]">
              <span dir="ltr" className="font-mono text-[#344054]">{m.card}</span>
              <span className="inline-flex items-center gap-1.5 text-xs"><Icon name="lock" size={14} />تحدده شركة TPA ولا يُعدَّل هنا</span>
            </div>
          </div>
          <label className="flex flex-col gap-1.5 font-semibold text-[#344054]">
            <span>سبب التعديل <span className="text-[#B42318]">*</span></span>
            <textarea rows={3} value={form.reason} onChange={set('reason')} maxLength={300}
              placeholder="مثال: تصحيح الاسم حسب شهادة الميلاد" className="px-3 py-2.5 border border-[#D5DCE6] rounded-[10px] font-normal resize-y" />
          </label>
          {error && <p role="alert" className="m-0 text-[#B42318] font-semibold">{error}</p>}
        </div>
        <div className="flex flex-wrap gap-2 px-6 py-4 border-t border-[#EEF1F5]">
          <button type="submit" disabled={saving} className={btn.primary}><Icon name="check" strokeWidth={2.4} />{saving ? 'جارٍ الحفظ…' : 'حفظ التعديل'}</button>
          <button type="button" onClick={onClose} className={btn.ghost}>إلغاء</button>
        </div>
      </form>
    </div>
  );
}
