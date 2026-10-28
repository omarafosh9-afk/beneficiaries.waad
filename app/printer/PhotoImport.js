'use client';
// رفع ملف مضغوط بالصور: اختيار الجهة والدفعة، رفع على أجزاء، ثم متابعة الاستيراد وعرض التقرير.
import { useEffect, useState } from 'react';
import { startImportAction, importStatusAction } from './actions';
import { Icon, btn } from '../review/ui';

const CHUNK = 8 * 1024 * 1024;
const input = 'h-10 px-3 border border-[#D5DCE6] rounded-[10px] bg-white';
const fmt = (n) => Number(n || 0).toLocaleString('en');

export default function PhotoImport({ targets }) {
  const [entityId, setEntityId] = useState(targets[0]?.id || '');
  const entity = targets.find((t) => t.id === Number(entityId));
  const [mode, setMode] = useState('batch');
  const [batch, setBatch] = useState('');
  const [replace, setReplace] = useState(false);
  const [file, setFile] = useState(null);
  const [upload, setUpload] = useState(null); // { sent, total }
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!entity) return;
    const hasBatches = entity.batches.length > 0;
    setMode(hasBatches ? 'batch' : 'seq');
    setBatch(hasBatches ? String(entity.batches[entity.batches.length - 1].batch) : '');
  }, [entityId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (job?.state !== 'running') return;
    const t = setTimeout(async () => {
      const r = await importStatusAction(job.id);
      if (!r.ok) return setError(r.error);
      setJob(r.job);
    }, 1500);
    return () => clearTimeout(t);
  }, [job]);

  const busy = !!upload || job?.state === 'running';
  const scope = mode === 'seq' ? entity?.seq : entity?.batches.find((b) => String(b.batch) === batch);

  async function start(e) {
    e.preventDefault();
    if (!file) return setError('اختر الملف المضغوط.');
    if (!/\.zip$/i.test(file.name)) return setError('الملف يجب أن يكون ZIP.');
    setError('');
    setJob(null);
    const id = crypto.randomUUID().replace(/-/g, '');
    try {
      for (let sent = 0; sent < file.size; sent += CHUNK) {
        setUpload({ sent, total: file.size });
        const res = await fetch(`/api/printer/upload?id=${id}&offset=${sent}`, { method: 'POST', body: file.slice(sent, sent + CHUNK) });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `تعذّر الرفع (${res.status}).`);
      }
    } catch (err) {
      setUpload(null);
      return setError(err.message);
    }
    setUpload(null);
    const r = await startImportAction({ uploadId: id, entityId, mode, batch, replace });
    if (!r.ok) return setError(r.error);
    setJob({ id: r.jobId, state: 'running', done: 0, total: 0 });
  }

  if (!targets.length) {
    return <section className="bg-white border border-[#E3E8EF] rounded-xl p-5">لا توجد قوائم مرقّمة بعد.</section>;
  }

  return (
    <>
      <section className="bg-white border border-[#E3E8EF] rounded-xl px-5 py-3 flex flex-wrap items-center gap-3">
        <span className="font-semibold">تصدير بيانات المستفيدين (Excel)</span>
        {targets.map((t) => (
          <a key={t.id} href={`/api/review/export?entity=${t.id}&grouped=0`} className={btn.ghost}><Icon name="download" />{t.name}</a>
        ))}
      </section>
      <form onSubmit={start} className="bg-white border border-[#E3E8EF] rounded-xl p-5 flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-[#344054]">
            جهة العمل
            <select value={entityId} onChange={(e) => setEntityId(Number(e.target.value))} disabled={busy} className={input}>
              {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-[#344054]">
            رقم الصورة يطابق
            <select value={mode} onChange={(e) => setMode(e.target.value)} disabled={busy} className={input}>
              {!!entity?.batches.length && <option value="batch">التسلسل داخل الدفعة</option>}
              {entity?.seq && <option value="seq">التسلسل العام</option>}
            </select>
          </label>
          {mode === 'batch' && (
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-[#344054]">
              الدفعة
              <select value={batch} onChange={(e) => setBatch(e.target.value)} disabled={busy} className={input}>
                {entity?.batches.map((b) => <option key={b.batch} value={b.batch}>الدفعة {b.batch}</option>)}
              </select>
            </label>
          )}
        </div>
        {scope && (
          <p className="m-0 text-[13px] text-[#5B6475]">
            الأرقام من 1 إلى {fmt(scope.max)} · {fmt(scope.count)} مستفيد، منهم {fmt(scope.withPhoto)} لديهم صورة و{fmt(scope.count - scope.withPhoto)} بلا صورة.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" accept=".zip,application/zip" id="zip" className="sr-only" disabled={busy}
            onChange={(e) => { setFile(e.target.files?.[0] || null); setError(''); }} />
          <label htmlFor="zip" className={`${btn.ghost} cursor-pointer`}><Icon name="upload" size={16} />{file ? 'تغيير الملف' : 'اختيار الملف المضغوط'}</label>
          {file && <span className="text-[13px]">{file.name} · {(file.size / 1024 / 1024).toFixed(1)} ميغابايت</span>}
        </div>
        <label className="flex items-center gap-2 text-[13px] font-medium">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} disabled={busy} className="w-[18px] h-[18px] accent-[#1D4ED8]" />
          استبدال الصور الموجودة (بدونه تُضاف الصور لمن ليس لديه صورة فقط)
        </label>
        <p className="m-0 text-[13px] text-[#5B6475]">اسم كل صورة يبدأ برقمها، مثل <span dir="ltr">15.jpg</span> أو <span dir="ltr">0015 - محمد.jpg</span>. الأنواع: JPG وPNG وWebP.</p>
        {error && <p role="alert" className="m-0 text-[#B42318] font-semibold">{error}</p>}
        <div>
          <button type="submit" disabled={busy || !file} className={btn.primary}><Icon name="upload" />رفع واستيراد</button>
        </div>
        {upload && <Progress label="رفع الملف" done={upload.sent} total={upload.total} unit="mb" />}
        {job?.state === 'running' && <Progress label="استيراد الصور" done={job.done} total={job.total} />}
      </form>
      {job && job.state !== 'running' && <Report job={job} />}
    </>
  );
}

function Progress({ label, done, total, unit }) {
  const pct = total ? Math.round((done * 100) / total) : 0;
  const show = (n) => (unit === 'mb' ? `${(n / 1024 / 1024).toFixed(0)} ميغابايت` : fmt(n));
  return (
    <div aria-live="polite" className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold">{label}: {show(done)} من {show(total)} ({pct}%)</span>
      <div className="h-2 rounded-full bg-[#EEF1F5] overflow-hidden"><div className="h-full bg-[#1D4ED8] rounded-full" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function Report({ job }) {
  if (job.state === 'failed') {
    return <section role="alert" className="bg-white border border-[#F5C2C0] rounded-xl p-5 text-[#B42318] font-semibold">فشل الاستيراد: {job.error}</section>;
  }
  const stats = [
    ['صور جديدة رُبطت', job.added, '#126B33'],
    ['صور استُبدلت', job.replaced, '#1D4ED8'],
    ['تُركت (لديهم صورة)', job.keptExisting.length, '#5B6475'],
    ['أرقام غير موجودة', job.notFound.length, '#B54708'],
    ['أرقام مكررة في الملف', job.duplicates.length, '#B54708'],
    ['بلا رقم في الاسم', job.noNumber.length, '#B54708'],
    ['تعذّرت قراءتها', job.failed.length, '#B42318'],
  ];
  const lists = [
    ['أرقام غير موجودة في المنظومة', job.notFound],
    ['أرقام مكررة (أُخذت الأولى فقط)', job.duplicates],
    ['صور بلا رقم في اسمها', job.noNumber],
    ['صور تعذّرت قراءتها', job.failed],
  ].filter(([, l]) => l.length);
  return (
    <section className="bg-white border border-[#E3E8EF] rounded-xl p-5 flex flex-col gap-4">
      <h2 className="m-0 text-base font-bold">تم الاستيراد · {job.target}</h2>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {stats.map(([label, n, color]) => (
          <div key={label} className="border border-[#EEF1F5] rounded-lg px-3 py-2">
            <div className="text-xl font-bold" style={{ color }}>{fmt(n)}</div>
            <div className="text-xs text-[#5B6475]">{label}</div>
          </div>
        ))}
      </div>
      <p className="m-0 text-[13px]">ما زال بلا صورة في هذا النطاق: <b>{fmt(job.stillWithoutPhoto)}</b> مستفيد{job.ignored ? ` · تُجوهل ${fmt(job.ignored)} ملف ليس صورة` : ''}.</p>
      {lists.map(([title, l]) => (
        <details key={title} className="border border-[#EEF1F5] rounded-lg px-3 py-2">
          <summary className="cursor-pointer font-semibold text-[13px]">{title} ({fmt(l.length)})</summary>
          <div dir="ltr" className="mt-2 max-h-60 overflow-y-auto font-mono text-xs text-[#344054] whitespace-pre-wrap">{l.join('\n')}</div>
        </details>
      ))}
    </section>
  );
}
