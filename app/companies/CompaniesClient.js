'use client';

import { useState } from 'react';
import { createEntityAction, previewImportAction, applyImportAction } from './actions';
import { btn, Icon } from '../review/ui';

const input = 'h-11 px-3 border border-[#D5DCE6] rounded-[10px] bg-white font-normal';
const card = 'bg-white border border-[#E3E8EF] rounded-2xl p-4 md:p-5 flex flex-col gap-3';

export default function CompaniesClient({ initialEntities }) {
  const [entities, setEntities] = useState(initialEntities);
  const [form, setForm] = useState({ name: '', code: '' });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const [entityId, setEntityId] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [impErr, setImpErr] = useState('');

  async function addEntity(e) {
    e.preventDefault();
    setBusy(true);
    const r = await createEntityAction(form);
    setBusy(false);
    if (!r.ok) return setMsg({ error: r.error });
    setEntities(r.entities);
    setForm({ name: '', code: '' });
    setMsg({ ok: `أُضيفت الجهة «${r.created.name}». أنشئ لها حسابًا من صفحة المستخدمين.` });
  }

  function fd() {
    const f = new FormData();
    f.set('entityId', entityId);
    f.set('file', file);
    return f;
  }

  async function runPreview(e) {
    e.preventDefault();
    setImpErr(''); setPreview(null); setResult(null);
    if (!entityId) return setImpErr('اختر الجهة.');
    if (!file) return setImpErr('اختر ملف Excel.');
    setBusy(true);
    const r = await previewImportAction(fd());
    setBusy(false);
    if (!r.ok) return setImpErr(r.error);
    setPreview(r.preview);
  }

  async function runApply() {
    setBusy(true);
    const r = await applyImportAction(fd());
    setBusy(false);
    if (!r.ok) return setImpErr(r.error);
    setEntities(r.entities);
    setPreview(null);
    setResult(r.result);
  }

  return (
    <>
      <section className={card}>
        <h2 className="m-0 text-base font-bold">الجهات</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse min-w-[520px]">
            <thead>
              <tr className="text-right text-[#5B6475] border-b border-[#E3E8EF]">
                <th className="py-2 px-2 font-semibold">الجهة</th>
                <th className="py-2 px-2 font-semibold">الرمز</th>
                <th className="py-2 px-2 font-semibold">المستفيدون</th>
                <th className="py-2 px-2 font-semibold">بصورة</th>
                <th className="py-2 px-2 font-semibold">الدفعات</th>
              </tr>
            </thead>
            <tbody>
              {entities.map((x) => (
                <tr key={x.id} className="border-b border-[#F0F2F5]">
                  <td className="py-2 px-2 font-semibold">{x.name}</td>
                  <td className="py-2 px-2 font-mono" dir="ltr">{x.code}</td>
                  <td className="py-2 px-2">{x.count}</td>
                  <td className="py-2 px-2">{x.photos}</td>
                  <td className="py-2 px-2">{x.batches}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form onSubmit={addEntity} className="flex flex-wrap items-end gap-2.5">
          <label className="flex flex-col gap-1 text-[13px] font-semibold">اسم الجهة الجديدة
            <input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="مثال: شركة الكهرباء" />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-semibold">الرمز بالإنجليزية
            <input className={`${input} font-mono`} dir="ltr" value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.replace(/[^A-Za-z0-9]/g, '') })} placeholder="Electric" />
          </label>
          <button type="submit" disabled={busy} className={`${btn.primary} h-11`}><Icon name="plus" size={16} />إضافة جهة</button>
        </form>
        <p className="m-0 text-xs text-[#5B6475]">الرمز اسم مجلد صور الجهة ولا يتغير بعد الإضافة.</p>
        {msg?.error && <p role="alert" className="m-0 text-sm text-[#B42318]">{msg.error}</p>}
        {msg?.ok && <p className="m-0 text-sm text-[#126B33]">{msg.ok}</p>}
      </section>

      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-base font-bold">استيراد قائمة مستفيدين</h2>
          <a href="/api/companies/template" className={btn.ghost}><Icon name="download" size={16} />تحميل القالب</a>
        </div>
        <p className="m-0 text-[13px] text-[#5B6475]">
          عبّئ القالب (التسلسل، الرقم الوظيفي، الاسم، صلة القرابة، تاريخ الميلاد، الرقم الوطني) ثم ارفعه. كل ملف يُضاف كدفعة جديدة للجهة،
          والتسلسل العام يكمل بعد آخر تسلسل. تظهر معاينة قبل الحفظ، والمكرر يُتخطى تلقائيًا.
        </p>
        <form onSubmit={runPreview} className="flex flex-wrap items-end gap-2.5">
          <label className="flex flex-col gap-1 text-[13px] font-semibold">الجهة
            <select className={input} value={entityId} onChange={(e) => { setEntityId(e.target.value); setPreview(null); }}>
              <option value="">اختر الجهة</option>
              {entities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-semibold">ملف Excel
            <input type="file" accept=".xlsx,.xls" className="text-sm"
              onChange={(e) => { setFile(e.target.files?.[0] || null); setPreview(null); setResult(null); }} />
          </label>
          <button type="submit" disabled={busy} className={`${btn.ghost} h-11`}><Icon name="search" size={16} />معاينة</button>
        </form>
        {impErr && <p role="alert" className="m-0 text-sm text-[#B42318]">{impErr}</p>}

        {preview && (
          <div className="flex flex-col gap-3 border-t border-[#E3E8EF] pt-3">
            <p className="m-0 text-sm">
              <b>{preview.entity}</b> · الدفعة <b>{preview.batch}</b> · سيُضاف <b>{preview.count}</b> مستفيدًا في <b>{preview.families}</b> عائلة
              {preview.count > 0 && <> · التسلسل العام من <b>{preview.firstSeq}</b> إلى <b>{preview.lastSeq}</b></>}
            </p>
            {!!preview.sample.length && (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px] border-collapse min-w-[520px]">
                  <thead>
                    <tr className="text-right text-[#5B6475] border-b border-[#E3E8EF]">
                      <th className="py-1.5 px-2">التسلسل</th><th className="py-1.5 px-2">الرقم الوظيفي</th><th className="py-1.5 px-2">الاسم</th>
                      <th className="py-1.5 px-2">الصلة</th><th className="py-1.5 px-2">الميلاد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample.map((r) => (
                      <tr key={r.serial} className="border-b border-[#F0F2F5]">
                        <td className="py-1.5 px-2">{r.serial}</td>
                        <td className="py-1.5 px-2 font-mono" dir="ltr">{r.job}</td>
                        <td className="py-1.5 px-2">{r.name}</td>
                        <td className="py-1.5 px-2">{r.relation}</td>
                        <td className="py-1.5 px-2" dir="ltr">{r.dob}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Issues title="أخطاء (لن تُستورد)" count={preview.errorCount} list={preview.errors} color="#B42318" />
            <Issues title="مكرر (سيُتخطى)" count={preview.skippedCount} list={preview.skipped} color="#B54708" />
            <div className="flex gap-2">
              <button type="button" disabled={busy || !preview.count} onClick={runApply} className={btn.primary}>
                <Icon name="check" size={16} />{busy ? 'جارٍ الحفظ…' : `استيراد ${preview.count} مستفيدًا`}
              </button>
              <button type="button" onClick={() => setPreview(null)} className={btn.ghost}>إلغاء</button>
            </div>
          </div>
        )}
        {result && (
          <p className="m-0 text-sm text-[#126B33] border-t border-[#E3E8EF] pt-3">
            تم استيراد {result.added} مستفيدًا إلى {result.entity} (الدفعة {result.batch}). تجدهم في شاشة المراجعة بحالة «بانتظار التحقق».
          </p>
        )}
      </section>
    </>
  );
}

function Issues({ title, count, list, color }) {
  if (!count) return null;
  return (
    <details className="text-[13px]">
      <summary className="cursor-pointer font-semibold" style={{ color }}>{title}: {count}</summary>
      <ul className="m-0 mt-1.5 pr-5 flex flex-col gap-0.5 max-h-60 overflow-y-auto">
        {list.map((e, i) => <li key={i}>صف {e.line}{e.name ? ` · ${e.name}` : ''}: {e.reason}</li>)}
        {count > list.length && <li>… و{count - list.length} غيرها</li>}
      </ul>
    </details>
  );
}
