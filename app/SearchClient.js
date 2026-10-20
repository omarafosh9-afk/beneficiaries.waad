'use client';

import { useEffect, useState, useCallback } from 'react';

const COMPANIES = [
  { value: '', label: 'كل الشركات' },
  { value: 'Cement', label: 'الاسمنت' },
  { value: 'Jalyana', label: 'جليانة' },
  { value: 'Jamarek', label: 'الجمارك' },
];

const RELATIONS = [
  { value: '', label: 'كل الصلات' },
  { value: 'موظف أساسي', label: 'موظف أساسي' },
  { value: 'زوجة', label: 'زوجة' },
  { value: 'زوج', label: 'زوج' },
  { value: 'ابن', label: 'ابن' },
  { value: 'ابنة', label: 'ابنة' },
  { value: 'أب', label: 'أب' },
  { value: 'أم', label: 'أم' },
];

const PHOTO_FILTERS = [
  { value: '', label: 'الكل' },
  { value: 'has', label: 'لديهم صورة' },
  { value: 'missing', label: 'بلا صورة' },
];

const SPECIAL_FILTERS = [
  { value: '', label: 'بلا فلتر خاص' },
  { value: 'husband_no_wife', label: 'أزواج بلا زوجات' },
  { value: 'wife_no_husband', label: 'زوجات بلا أزواج' },
  { value: 'duplicate', label: 'بطاقات مكررة' },
  { value: 'wife_multi_card', label: 'زوجات ببطاقتين مختلفتين' },
  { value: 'same_two_cards', label: 'نفس الرقم مكرر في البطاقتين (لنفس الشخص)' },
  { value: 'batch1', label: 'الدفعة الأولى (جليانة)' },
  { value: 'has_two_cards', label: 'لديهم بطاقتان (الكل)' },
];

const DELETED_FILTERS = [
  { value: '', label: 'إخفاء المحذوفة' },
  { value: 'all', label: 'إظهار الكل' },
  { value: 'only', label: 'المحذوفة فقط' },
];

export default function SearchClient({ onPick, refreshKey }) {
  const [q, setQ] = useState('');
  const [exactNum, setExactNum] = useState(false);
  const [company, setCompany] = useState('');
  const [relation, setRelation] = useState('');
  const [photo, setPhoto] = useState('');
  const [special, setSpecial] = useState('');
  const [deleted, setDeleted] = useState('');
  const [page, setPage] = useState(1);

  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [exporting, setExporting] = useState(false);

  const isNumericQuery = /^\d+$/.test(q.trim());

  const runSearch = useCallback(async (query, exact, comp, rel, ph, sp, del, pg) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (exact && /^\d+$/.test(query.trim())) params.set('exactNum', '1');
    if (comp) params.set('company', comp);
    if (rel) params.set('relation', rel);
    if (ph) params.set('photo', ph);
    if (sp) params.set('special', sp);
    if (del) params.set('deleted', del);
    params.set('page', String(pg));
    const res = await fetch(`/api/search?${params.toString()}`);
    const data = await res.json();
    setTotal(data.total);
    setTotalPages(data.totalPages);
    setResults(data.results);
    setLoading(false);
  }, []);

  // أي تغيير في الفلاتر أو البحث يعيد الترقيم للصفحة 1
  useEffect(() => {
    setPage(1);
  }, [q, exactNum, company, relation, photo, special, deleted]);

  useEffect(() => {
    const t = setTimeout(() => runSearch(q, exactNum, company, relation, photo, special, deleted, page), 250);
    return () => clearTimeout(t);
  }, [q, exactNum, company, relation, photo, special, deleted, page, refreshKey, runSearch]);

  function toggleOne(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const allOnPageSelected = results.length > 0 && results.every((p) => selected.has(p.id));
  function toggleAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) results.forEach((p) => next.delete(p.id));
      else results.forEach((p) => next.add(p.id));
      return next;
    });
  }

  async function handleBulkExport() {
    if (!selected.size || exporting) return;
    setExporting(true);
    try {
      const res = await fetch('/api/export-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selected] }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'تعذر التصدير');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'photos_export.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  async function handleBulkDelete() {
    if (!selected.size || bulkDeleting) return;
    setBulkDeleting(true);
    try {
      const res = await fetch('/api/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selected] }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'تعذر الحذف');
        return;
      }
      setSelected(new Set());
      setConfirmingBulkDelete(false);
      runSearch(q, exactNum, company, relation, photo, special, deleted, page);
    } finally {
      setBulkDeleting(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="text"
          placeholder="ابحث بالاسم أو رقم البطاقة..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="flex-1 min-w-[220px] border border-gray-300 rounded-lg px-4 py-2 text-lg bg-white text-gray-900 placeholder:text-gray-400"
        />
        {isNumericQuery && (
          <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer whitespace-nowrap">
            <input type="checkbox" checked={exactNum} onChange={(e) => setExactNum(e.target.checked)} />
            بحث دقيق بالرقم (لا يطابق كل ما يحتوي {q})
          </label>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <Select value={company} onChange={setCompany} options={COMPANIES} />
        <Select value={relation} onChange={setRelation} options={RELATIONS} />
        <Select value={photo} onChange={setPhoto} options={PHOTO_FILTERS} />
        <Select value={special} onChange={setSpecial} options={SPECIAL_FILTERS} />
        <Select value={deleted} onChange={setDeleted} options={DELETED_FILTERS} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-sm text-gray-600">
          {loading ? 'جارٍ البحث...' : `${total} نتيجة${totalPages > 1 ? ` — صفحة ${page} من ${totalPages}` : ''}`}
        </p>
        <div className="flex items-center gap-2">
          {results.length > 0 && (
            <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
              <input type="checkbox" checked={allOnPageSelected} onChange={toggleAllOnPage} />
              تحديد كل الصفحة
            </label>
          )}
          {selected.size > 0 && (
            <>
              <span className="text-xs text-gray-600">{selected.size} محدد</span>
              <button
                type="button"
                onClick={handleBulkExport}
                disabled={exporting}
                className="text-xs bg-blue-600 text-white rounded-lg px-3 py-1.5 font-medium disabled:opacity-50"
              >
                {exporting ? 'جارٍ التصدير...' : 'تصدير المحدد (ZIP)'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingBulkDelete(true)}
                className="text-xs border border-red-300 text-red-600 rounded-lg px-3 py-1.5 font-medium hover:bg-red-50"
              >
                حذف المحدد
              </button>
              <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-gray-500 underline">
                إلغاء التحديد
              </button>
            </>
          )}
        </div>
      </div>

      {confirmingBulkDelete && (
        <div className="border border-red-300 bg-red-50 rounded-lg p-3 mb-4 text-sm">
          <p className="text-red-700 mb-2">تأكيد حذف {selected.size} بطاقة محددة؟ (حذف ناعم، يمكن استعادتها لاحقا من فلتر "المحذوفة")</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="flex-1 bg-red-600 text-white rounded-lg py-1.5 text-xs font-medium disabled:opacity-50"
            >
              {bulkDeleting ? 'جارٍ الحذف...' : `تأكيد حذف ${selected.size}`}
            </button>
            <button type="button" onClick={() => setConfirmingBulkDelete(false)} className="flex-1 border border-gray-300 rounded-lg py-1.5 text-xs">
              إلغاء
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {results.map((p) => (
          <div
            key={p.id}
            className={`relative bg-white border rounded-xl p-3 text-right hover:shadow-md transition ${p.deleted ? 'border-red-300 opacity-60' : 'border-gray-200 hover:border-blue-400'}`}
          >
            {p.deleted && (
              <span className="absolute top-2 right-2 z-10 bg-red-600 text-white text-[10px] rounded px-1.5 py-0.5">محذوف</span>
            )}
            <label
              className="absolute top-2 left-2 z-10 bg-white/90 rounded p-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleOne(p.id)} />
            </label>
            <button
              onClick={() => onPick(p)}
              className="w-full aspect-square rounded-lg overflow-hidden bg-gray-100 mb-2 flex items-center justify-center"
            >
              {p.hasPhoto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/photos/${p.company}/${encodeURIComponent(p.photoSlug)}.webp`}
                  alt={p.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-3xl text-gray-300">👤</span>
              )}
            </button>
            <div className="text-right select-text">
              <div className="font-medium text-sm leading-snug line-clamp-2 text-gray-900">{p.name}</div>
              <div className="text-xs text-gray-600 mt-1" dir="ltr">{p.card1 || p.card2 || '—'}</div>
              {p.card2 && p.card1 && (
                p.card2.trim().toUpperCase() === p.card1.trim().toUpperCase() ? (
                  <div className="text-xs text-amber-600 mt-0.5" dir="ltr">٢: {p.card2} (مكرر حرفيا)</div>
                ) : (
                  <div className="text-xs text-red-600 mt-0.5" dir="ltr">٢: {p.card2}</div>
                )
              )}
              {p.dob && <div className="text-xs text-gray-500 mt-0.5" dir="ltr">{p.dob}</div>}
              {p.batch === 1 && <span className="inline-block text-[10px] bg-emerald-100 text-emerald-800 rounded px-1.5 py-0.5 mt-1">دفعة أولى</span>}
              <div className="text-xs text-blue-700 mt-0.5">{p.companyLabel}{p.relation ? ` · ${p.relation}` : ''}</div>
            </div>
          </div>
        ))}
      </div>

      {results.length === 0 && !loading && (
        <p className="text-center text-gray-400 py-10">لا توجد نتائج مطابقة</p>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <PageBtn onClick={() => setPage(1)} disabled={page <= 1}>الأولى</PageBtn>
          <PageBtn onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>السابق</PageBtn>
          <span className="text-sm text-gray-600 px-2">{page} / {totalPages}</span>
          <PageBtn onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>التالي</PageBtn>
          <PageBtn onClick={() => setPage(totalPages)} disabled={page >= totalPages}>الأخيرة</PageBtn>
        </div>
      )}
    </div>
  );
}

function Select({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border border-gray-300 rounded-lg px-3 py-1.5 bg-white text-gray-900 text-sm"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function PageBtn({ onClick, disabled, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white text-gray-800 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100"
    >
      {children}
    </button>
  );
}
