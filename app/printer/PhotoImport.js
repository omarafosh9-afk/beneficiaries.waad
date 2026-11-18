'use client';
// رفع ملف مضغوط بالصور: اختيار الجهة والدفعة، رفع على أجزاء، ثم معاينة الربط وتأكيده، ثم متابعة الاستيراد وعرض التقرير.
import { useEffect, useState } from 'react';
import { startImportAction, importStatusAction, previewImportAction, discardUploadAction } from './actions';
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
  const [uploaded, setUploaded] = useState(null); // معرّف الملف المرفوع بانتظار التأكيد
  const [preview, setPreview] = useState(null);

  // المعاينة تُعاد عند تغيير الجهة أو الطريقة أو الدفعة، بلا إعادة رفع.
  useEffect(() => {
    if (!uploaded) return;
    setPreview(null);
    previewImportAction({ uploadId: uploaded, entityId, mode, batch }).then((r) => (r.ok ? setPreview(r.preview) : setError(r.error)));
  }, [uploaded, entityId, mode, batch]);

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
  const locked = busy || !!uploaded;
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
    setUploaded(id);
  }

  async function confirm() {
    const r = await startImportAction({ uploadId: uploaded, entityId, mode, batch, replace });
    setUploaded(null);
    setPreview(null);
    if (!r.ok) return setError(r.error);
    setJob({ id: r.jobId, state: 'running', done: 0, total: 0 });
  }

  async function cancel() {
    await discardUploadAction(uploaded);
    setUploaded(null);
    setPreview(null);
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
          <input type="file" accept=".zip,application/zip" id="zip" className="sr-only" disabled={locked}
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
          {!uploaded && <button type="submit" disabled={busy || !file} className={btn.primary}><Icon name="upload" />رفع ومعاينة</button>}
        </div>
        {upload && <Progress label="رفع الملف" done={upload.sent} total={upload.total} unit="mb" />}
        {job?.state === 'running' && <Progress label="استيراد الصور" done={job.done} total={job.total} />}
        {uploaded && !preview && <p className="m-0 text-[13px]">جارٍ تجهيز المعاينة…</p>}
        {uploaded && preview && <Preview p={preview} mode={mode} batch={batch} onConfirm={confirm} onCancel={cancel} />}
      </form>
      {job && job.state !== 'running' && <Report job={job} />}
    </>
  );
}

// معاينة الربط قبل الاستيراد: كل صورة ← صاحبها بالرقمين، مع تحذير إن اختلفت الطريقتان.
function Preview({ p, mode, batch, onConfirm, onCancel }) {
  const person = (x) => (x ? `${x.name} (تسلسل عام ${x.seq ?? '—'} · د${x.batch ?? '—'}·${x.serial ?? '—'})` : '— لا أحد —');
  const risky = p.differs > 0;
  return (
    <div className="flex flex-col gap-3 border-t border-[#EEF1F5] pt-4">
      <h3 className="m-0 text-[15px] font-bold">معاينة الربط · {mode === 'seq' ? 'التسلسل العام' : `التسلسل داخل الدفعة ${batch}`}</h3>
      <p className="m-0 text-[13px]">
        {fmt(p.total)} صورة: <b>{fmt(p.matched)}</b> لها صاحب، {fmt(p.notFound)} رقمها غير موجود{p.noNumber ? `، ${fmt(p.noNumber)} بلا رقم` : ''}.
      </p>
      {risky && (
        <p role="alert" className="m-0 px-3 py-2 rounded-lg bg-[#FEF3F2] border border-[#F5C2C0] text-[13px] font-semibold text-[#B42318]">
          تنبيه: {fmt(p.differs)} صورة تذهب لشخص مختلف لو اختير «{p.altLabel}». تأكد من الأسماء أدناه أنها صحيحة قبل الاستيراد، أو غيّر طريقة الربط.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] border-collapse min-w-[560px]">
          <thead>
            <tr className="text-right text-[#5B6475] border-b border-[#E3E8EF]">
              <th className="py-1.5 px-2">الصورة</th><th className="py-1.5 px-2">تُربط بـ</th>{risky && <th className="py-1.5 px-2">لو اختير «{p.altLabel}»</th>}
            </tr>
          </thead>
          <tbody>
            {p.sample.map((x) => (
              <tr key={x.file} className="border-b border-[#F0F2F5]">
                <td className="py-1.5 px-2 font-mono" dir="ltr">{x.file}</td>
                <td className="py-1.5 px-2 font-semibold">{person(x.to)}{x.to?.hasPhoto ? ' · لديه صورة' : ''}</td>
                {risky && <td className="py-1.5 px-2 text-[#5B6475]">{person(x.alt)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="m-0 text-xs text-[#5B6475]">أول {p.sample.length} صورة. قارن اسم صاحب الصورة بما تعرفه عنها قبل التأكيد.</p>
      <div className="flex gap-2">
        <button type="button" onClick={onConfirm} disabled={!p.matched} className={btn.primary}><Icon name="check" />تأكيد واستيراد {fmt(p.matched)} صورة</button>
        <button type="button" onClick={onCancel} className={btn.ghost}>إلغاء</button>
      </div>
    </div>
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
