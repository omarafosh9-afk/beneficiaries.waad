'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { addPerson } from './actions';

const initialState = { ok: null, message: '' };

const RELATIONS = ['موظف أساسي', 'زوجة', 'زوج', 'ابن', 'ابنة', 'أب', 'أم'];

const emptyForm = { company: '', name: '', card1: '', relation: '', dob: '' };

export default function AddPersonModal({ onClose, onSaved }) {
  const [state, formAction, pending] = useActionState(addPerson, initialState);
  const [form, setForm] = useState(emptyForm);
  const formRef = useRef(null);
  const confirmRef = useRef(null);

  useEffect(() => {
    if (state.ok) {
      setForm(emptyForm);
      onSaved();
    }
  }, [state, onSaved]);

  function set(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  function confirmAnyway() {
    if (confirmRef.current) confirmRef.current.value = '1';
    formRef.current?.requestSubmit();
  }

  function editInstead() {
    // أعد ضبط تأكيد التكرار حتى تُعاد الفحوصات عند إرسال لاحق بعد التعديل
    if (confirmRef.current) confirmRef.current.value = '0';
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-lg font-bold">إضافة شخص جديد</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>

        <form ref={formRef} action={formAction} className="space-y-2 text-sm">
          <input ref={confirmRef} type="hidden" name="confirmDuplicate" defaultValue="0" />
          <Field label="الشركة *">
            <select name="company" required value={form.company} onChange={set('company')} className="w-full border rounded-lg px-2 py-1.5">
              <option value="">اختر...</option>
              <option value="Cement">الاسمنت</option>
              <option value="Jalyana">جليانة</option>
              <option value="Jamarek">الجمارك</option>
            </select>
          </Field>
          <Field label="الاسم الكامل *">
            <input name="name" required value={form.name} onChange={set('name')} className="w-full border rounded-lg px-2 py-1.5" />
          </Field>
          <Field label="رقم البطاقة الأول *">
            <input name="card1" required dir="ltr" value={form.card1} onChange={set('card1')} className="w-full border rounded-lg px-2 py-1.5" />
          </Field>
          <Field label="صلة القرابة">
            <select name="relation" value={form.relation} onChange={set('relation')} className="w-full border rounded-lg px-2 py-1.5">
              <option value="">بلا تحديد</option>
              {RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="تاريخ الميلاد">
            <input name="dob" type="date" value={form.dob} onChange={set('dob')} className="w-full border rounded-lg px-2 py-1.5" />
          </Field>
          <Field label="الصورة (اختياري)">
            <input name="file" type="file" accept="image/*" className="block w-full text-sm" />
          </Field>

          <button
            type="submit"
            onClick={editInstead}
            disabled={pending}
            className="w-full bg-green-600 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50 mt-3"
          >
            {pending ? 'جارٍ الحفظ...' : 'إضافة'}
          </button>

          {state.duplicate && (
            <div className="border border-amber-300 bg-amber-50 rounded-lg p-3 mt-2">
              <p className="text-amber-800 font-medium mb-2">⚠ اشتباه تكرار — راجع قبل المتابعة:</p>
              <ul className="space-y-1 mb-3">
                {state.matches.map((m, i) => (
                  <li key={i} className="text-xs text-amber-900">
                    <span className="font-medium">{m.name}</span> ({m.company}) — {m.card} — <span className="italic">{m.reason}</span>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <button type="button" onClick={confirmAnyway} className="flex-1 bg-amber-600 text-white rounded-lg py-1.5 text-xs font-medium">
                  إضافة رغم ذلك
                </button>
                <button type="button" onClick={editInstead} className="flex-1 border border-amber-400 text-amber-800 rounded-lg py-1.5 text-xs">
                  تعديل البيانات
                </button>
              </div>
            </div>
          )}

          {state.message && !state.duplicate && (
            <p className={`text-xs mt-1 ${state.ok ? 'text-green-600' : 'text-red-600'}`}>{state.message}</p>
          )}
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-gray-600 mb-0.5">{label}</span>
      {children}
    </label>
  );
}
