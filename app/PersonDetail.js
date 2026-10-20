'use client';

import { useActionState, useState, useEffect, useRef } from 'react';
import { updatePerson, deletePerson, restorePerson } from './actions';

const initialEditState = { ok: null, message: '' };
const initialDeleteState = { ok: null, message: '' };
const RELATIONS = ['موظف أساسي', 'زوجة', 'زوج', 'ابن', 'ابنة', 'أب', 'أم'];

export default function PersonDetail({ person, onClose, onSaved }) {
  const [editState, editAction, editPending] = useActionState(updatePerson, initialEditState);
  const [deleteState, deleteAction, deletePending] = useActionState(deletePerson, initialDeleteState);
  const [restoreState, restoreAction, restorePending] = useActionState(restorePerson, initialDeleteState);
  const [preview, setPreview] = useState(null);
  const [bump, setBump] = useState(0);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [current, setCurrent] = useState(person);
  const editFormRef = useRef(null);
  const editConfirmRef = useRef(null);

  useEffect(() => {
    setPreview(null);
    setEditing(false);
    setConfirmingDelete(false);
    setCurrent(person);
  }, [person]);

  useEffect(() => {
    if (editState.ok && editState.person) {
      setCurrent(editState.person);
      setEditing(false);
      setPreview(null);
      setBump((n) => n + 1); // لإجبار إعادة تحميل الصورة إن تغيّرت
      onSaved?.();
    }
  }, [editState, onSaved]);

  useEffect(() => {
    if (deleteState.ok && deleteState.person) {
      setCurrent(deleteState.person);
      setConfirmingDelete(false);
      onSaved?.();
    }
  }, [deleteState, onSaved]);

  useEffect(() => {
    if (restoreState.ok && restoreState.person) {
      setCurrent(restoreState.person);
      onSaved?.();
    }
  }, [restoreState, onSaved]);

  if (!current) return null;
  const p = current;

  const photoUrl = `/storage/${p.company}/${encodeURIComponent(p.photoSlug)}.webp?v=${bump}`;
  const card = p.card1 || p.card2 || '';
  const downloadName = `${p.name}_${card}`.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim() + '.webp';

  async function handleExport() {
    const res = await fetch(photoUrl);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-lg font-bold">{p.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>

        <div className="w-32 h-32 rounded-xl overflow-hidden bg-gray-100 mb-2 flex items-center justify-center mx-auto">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="w-full h-full object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl}
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          )}
        </div>

        {!preview && (
          <button type="button" onClick={handleExport} className="block mx-auto mb-4 text-xs text-blue-600 hover:text-blue-800 underline">
            تصدير الصورة WebP
          </button>
        )}

        {p.deleted && (
          <div className="border border-red-300 bg-red-50 rounded-lg p-3 mb-3 text-sm">
            <p className="text-red-700 font-medium mb-2">هذه البطاقة محذوفة (حذف ناعم) — مخفية من البحث الافتراضي.</p>
            <form action={restoreAction}>
              <input type="hidden" name="id" value={p.id} />
              <button type="submit" disabled={restorePending} className="w-full bg-green-600 text-white rounded-lg py-1.5 text-xs font-medium disabled:opacity-50">
                {restorePending ? 'جارٍ الاستعادة...' : 'استعادة البطاقة'}
              </button>
            </form>
          </div>
        )}

        {!editing ? (
          <>
            <dl className="text-sm space-y-1 mb-3">
              <Row label="الشركة" value={p.companyLabel} />
              {p.relation && <Row label="صلة القرابة" value={p.relation} />}
              {p.primaryName && <Row label="الموظف الأساسي" value={p.primaryName} />}
              <Row label="رقم البطاقة الأول" value={p.card1} />
              {p.card2 && <Row label="رقم البطاقة الثاني" value={p.card2} />}
              {p.job && <Row label="الرقم الوظيفي" value={p.job} />}
              {p.national && <Row label="الرقم الوطني" value={p.national} />}
              <Row label="تاريخ الميلاد" value={p.dob || '—'} />
              {p.status && <Row label="الحالة" value={p.status} />}
            </dl>
            {!p.deleted && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="flex-1 border border-gray-300 rounded-lg py-1.5 text-sm hover:bg-gray-50"
                >
                  تعديل البيانات / الصورة
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="border border-red-300 text-red-600 rounded-lg py-1.5 px-3 text-sm hover:bg-red-50"
                >
                  حذف
                </button>
              </div>
            )}

            {confirmingDelete && (
              <div className="border border-red-300 bg-red-50 rounded-lg p-3 mt-2 text-sm">
                <p className="text-red-700 mb-2">تأكيد حذف بطاقة "{p.name}"؟ يمكن استعادتها لاحقا من فلتر "المحذوفة".</p>
                <div className="flex gap-2">
                  <form action={deleteAction} className="flex-1">
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" disabled={deletePending} className="w-full bg-red-600 text-white rounded-lg py-1.5 text-xs font-medium disabled:opacity-50">
                      {deletePending ? 'جارٍ الحذف...' : 'تأكيد الحذف'}
                    </button>
                  </form>
                  <button type="button" onClick={() => setConfirmingDelete(false)} className="flex-1 border border-gray-300 rounded-lg py-1.5 text-xs">
                    إلغاء
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <form ref={editFormRef} action={editAction} className="space-y-2 text-sm">
            <input type="hidden" name="id" value={p.id} />
            <input ref={editConfirmRef} type="hidden" name="confirmDuplicate" defaultValue="0" />
            <label className="block">
              <span className="block text-gray-600 mb-0.5">الشركة</span>
              <select name="company" defaultValue={p.company} className="w-full border rounded-lg px-2 py-1.5">
                <option value="Cement">الاسمنت</option>
                <option value="Jalyana">جليانة</option>
                <option value="Jamarek">الجمارك</option>
              </select>
            </label>
            <EField label="الاسم" name="name" defaultValue={p.name} />
            <EField label="رقم البطاقة الأول" name="card1" defaultValue={p.card1} dir="ltr" />
            <label className="block">
              <span className="block text-gray-600 mb-0.5">صلة القرابة</span>
              <select name="relation" defaultValue={p.relation} className="w-full border rounded-lg px-2 py-1.5">
                <option value="">بلا تحديد</option>
                {RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <EField label="تاريخ الميلاد" name="dob" defaultValue={p.dob} type="date" />

            <label className="block pt-1">
              <span className="block text-gray-600 mb-0.5">استيراد / تحديث الصورة (اختياري)</span>
              <input
                type="file"
                name="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setPreview(URL.createObjectURL(f)); else setPreview(null);
                }}
                className="block w-full text-sm"
              />
            </label>

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                onClick={() => { if (editConfirmRef.current) editConfirmRef.current.value = '0'; }}
                disabled={editPending}
                className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
              >
                {editPending ? 'جارٍ الحفظ...' : 'حفظ'}
              </button>
              <button type="button" onClick={() => { setEditing(false); setPreview(null); }} className="flex-1 border border-gray-300 rounded-lg py-2 text-sm">
                إلغاء
              </button>
            </div>

            {editState.duplicate && (
              <div className="border border-amber-300 bg-amber-50 rounded-lg p-3 mt-2">
                <p className="text-amber-800 font-medium mb-2">⚠ اشتباه تكرار — راجع قبل المتابعة:</p>
                <ul className="space-y-1 mb-3">
                  {editState.matches.map((m, i) => (
                    <li key={i} className="text-xs text-amber-900">
                      <span className="font-medium">{m.name}</span> ({m.company}) — {m.card} — <span className="italic">{m.reason}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => { if (editConfirmRef.current) editConfirmRef.current.value = '1'; editFormRef.current?.requestSubmit(); }}
                  className="w-full bg-amber-600 text-white rounded-lg py-1.5 text-xs font-medium"
                >
                  حفظ رغم التكرار
                </button>
              </div>
            )}

            {editState.message && !editState.duplicate && (
              <p className={`text-xs ${editState.ok ? 'text-green-600' : 'text-red-600'}`}>{editState.message}</p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-gray-500">{label}</dt>
      <dd className="font-medium text-left" dir="auto">{value}</dd>
    </div>
  );
}

function EField({ label, name, defaultValue, type = 'text', dir }) {
  return (
    <label className="block">
      <span className="block text-gray-600 mb-0.5">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue || ''}
        dir={dir}
        className="w-full border rounded-lg px-2 py-1.5"
      />
    </label>
  );
}
