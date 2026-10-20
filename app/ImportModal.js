'use client';

import { useActionState, useState, useEffect } from 'react';
import { importExcel, forceAddSkippedRows } from './actions';

const initialState = { ok: null, message: '' };

export default function ImportModal({ onClose, onSaved }) {
  const [state, formAction, pending] = useActionState(importExcel, initialState);
  const [forceState, forceAction, forcePending] = useActionState(forceAddSkippedRows, initialState);
  const [downloading, setDownloading] = useState(false);
  const [company, setCompany] = useState('');
  const [reportRows, setReportRows] = useState(null);

  // زامِن نسخة محلية قابلة للتعديل من التقرير عند وصوله من الاستيراد الأول
  useEffect(() => {
    if (state.report) setReportRows(state.report);
  }, [state.report]);

  // بعد إضافة حالات التكرار قسرا، حدّث حالة الصفوف محليا لتعكس ذلك (بدل إعادة
  // استيراد الملف كله من جديد، تجنبا لإضافة الصفوف السليمة مرتين).
  useEffect(() => {
    if (forceState.ok) {
      setReportRows((prev) => (prev || []).map((r) => (r.status.startsWith('تكرار') ? { ...r, status: 'أُضيف رغم التكرار (يدويا)' } : r)));
    }
  }, [forceState]);

  function submitForceAdd() {
    const skipped = (reportRows || []).filter((r) => r.status.startsWith('تكرار'));
    if (!skipped.length) return;
    const rowsJson = JSON.stringify(skipped.map((r) => ({ name: r.name, card1: r.card1, dob: r.dob })));
    const fd = new FormData();
    fd.set('company', company);
    fd.set('rowsJson', rowsJson);
    forceAction(fd);
  }

  async function downloadReport() {
    if (!reportRows) return;
    setDownloading(true);
    try {
      const res = await fetch('/api/import-report-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report: reportRows }),
      });
      if (!res.ok) { alert('تعذر توليد التقرير'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'import_report.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  const skippedCount = (reportRows || []).filter((r) => r.status.startsWith('تكرار')).length;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-lg font-bold">استيراد من إكسل</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>

        <p className="text-xs text-gray-500 mb-3">
          قالب بسيط بثلاثة أعمدة برأس واضح: <span className="font-medium">الاسم</span>، <span className="font-medium">رقم البطاقة</span>، <span className="font-medium">المواليد</span> (اختياري).
        </p>

        <form action={formAction} className="space-y-3 text-sm">
          <label className="block">
            <span className="block text-gray-600 mb-0.5">الشركة *</span>
            <select
              name="company"
              required
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className="w-full border rounded-lg px-2 py-1.5"
            >
              <option value="">اختر...</option>
              <option value="Cement">الاسمنت</option>
              <option value="Jalyana">جليانة</option>
              <option value="Jamarek">الجمارك</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-gray-600 mb-0.5">ملف الإكسل *</span>
            <input name="file" type="file" accept=".xlsx,.xls" required className="block w-full text-sm" />
          </label>

          <button
            type="submit"
            disabled={pending}
            className="w-full bg-green-600 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
          >
            {pending ? 'جارٍ الاستيراد...' : 'استيراد'}
          </button>

          {state.message && (
            <p className={`text-xs ${state.ok ? 'text-green-700' : 'text-red-600'}`}>{state.message}</p>
          )}
        </form>

        {state.summary && reportRows && (
          <div className="mt-4">
            <div className="flex flex-wrap gap-3 text-xs mb-3">
              <span className="bg-green-100 text-green-800 rounded px-2 py-1">أُضيف: {state.summary.added}</span>
              <span className="bg-amber-100 text-amber-800 rounded px-2 py-1">تكرار متخطّى: {skippedCount}</span>
              <span className="bg-red-100 text-red-800 rounded px-2 py-1">أخطاء: {state.summary.errors}</span>
              <span className="bg-gray-100 text-gray-700 rounded px-2 py-1">الإجمالي: {state.summary.total}</span>
            </div>

            <div className="flex flex-wrap gap-2 mb-3">
              {skippedCount > 0 && (
                <button
                  type="button"
                  onClick={submitForceAdd}
                  disabled={forcePending}
                  className="text-xs bg-amber-600 text-white rounded-lg px-3 py-1.5 font-medium disabled:opacity-50"
                >
                  {forcePending ? 'جارٍ الإضافة...' : `إضافة حالات التكرار المتخطاة (${skippedCount}) أيضا`}
                </button>
              )}
              <button
                type="button"
                onClick={downloadReport}
                disabled={downloading}
                className="text-xs border border-gray-300 rounded-lg px-3 py-1.5 font-medium disabled:opacity-50"
              >
                {downloading ? 'جارٍ التصدير...' : 'تنزيل التقرير كإكسل'}
              </button>
              <button
                type="button"
                onClick={() => { onSaved(); onClose(); }}
                className="text-xs bg-blue-600 text-white rounded-lg px-3 py-1.5 font-medium mr-auto"
              >
                تم — إغلاق وتحديث القائمة
              </button>
            </div>

            <div className="border rounded-lg overflow-hidden max-h-72 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="p-2 text-right">الصف</th>
                    <th className="p-2 text-right">الاسم</th>
                    <th className="p-2 text-right" dir="ltr">البطاقة</th>
                    <th className="p-2 text-right">الحالة</th>
                    <th className="p-2 text-right">ملاحظة</th>
                  </tr>
                </thead>
                <tbody>
                  {reportRows.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2">{r.row}</td>
                      <td className="p-2">{r.name}</td>
                      <td className="p-2" dir="ltr">{r.card1}</td>
                      <td className={`p-2 ${r.status.startsWith('أُضيف') ? 'text-green-700' : r.status.startsWith('تكرار') ? 'text-amber-700' : 'text-red-700'}`}>{r.status}</td>
                      <td className="p-2 text-gray-500">{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
