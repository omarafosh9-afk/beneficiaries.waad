'use client';

import { useState } from 'react';
import { rescanAction, fixIssueAction } from './actions';
import { btn, Icon, Dialog } from '../review/ui';

const SEV = {
  high: { label: 'عاجل', bg: '#FEE4E2', fg: '#B42318' },
  medium: { label: 'مهم', bg: '#FFF1E5', fg: '#B54708' },
  low: { label: 'للمراجعة', bg: '#EEF1F5', fg: '#475467' },
};
const fmt = (n) => Number(n || 0).toLocaleString('en');

export default function IssuesClient({ initial }) {
  const [issues, setIssues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [confirm, setConfirm] = useState(null);

  async function rescan() {
    setBusy(true);
    const r = await rescanAction();
    setBusy(false);
    if (!r.ok) return setMsg({ error: r.error });
    setIssues(r.issues);
    setMsg({ ok: 'أُعيد الفحص.' });
  }

  async function fix() {
    const x = confirm;
    setConfirm(null);
    setBusy(true);
    const r = await fixIssueAction(x.entityId, x.key);
    setBusy(false);
    if (!r.ok) return setMsg({ error: r.error });
    setIssues(r.issues);
    const d = r.result || {};
    setMsg({ ok: `${x.entity} · ${x.title}: صُحّح ${fmt(d.fixed)}${d.detached ? `، وفُصلت ${fmt(d.detached)} صورة بلا صاحب` : ''}${d.skipped ? `، وتُرك ${fmt(d.skipped)} للمراجعة` : ''}.` });
  }

  const byEntity = new Map();
  for (const i of issues) (byEntity.get(i.entity) || byEntity.set(i.entity, []).get(i.entity)).push(i);
  const high = issues.filter((i) => i.severity === 'high').reduce((n, i) => n + i.count, 0);

  return (
    <>
      <section className="bg-white border border-[#E3E8EF] rounded-xl px-5 py-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm">
          {issues.length ? <>وُجدت <b>{fmt(issues.length)}</b> مشكلة في <b>{fmt(byEntity.size)}</b> جهة{high ? <>، منها <b className="text-[#B42318]">{fmt(high)}</b> سجل عاجل</> : ''}.</> : 'لا توجد مشاكل مكتشفة.'}
        </span>
        <button type="button" onClick={rescan} disabled={busy} className={btn.ghost}><Icon name="search" size={16} />{busy ? 'جارٍ الفحص…' : 'إعادة الفحص'}</button>
      </section>
      {msg?.error && <p role="alert" className="m-0 text-sm font-semibold text-[#B42318]">{msg.error}</p>}
      {msg?.ok && <p className="m-0 text-sm font-semibold text-[#126B33]">{msg.ok}</p>}

      {[...byEntity].map(([entity, list]) => (
        <section key={entity} className="bg-white border border-[#E3E8EF] rounded-xl p-4 md:p-5 flex flex-col gap-3">
          <h2 className="m-0 text-base font-bold">{entity}</h2>
          {list.map((i) => (
            <div key={i.key} className="border border-[#EEF1F5] rounded-lg p-3 flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1 min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex h-6 items-center px-2 rounded-full text-[11px] font-bold" style={{ background: SEV[i.severity].bg, color: SEV[i.severity].fg }}>{SEV[i.severity].label}</span>
                  <b className="text-[14px]">{i.title}</b>
                  <span className="text-[13px] text-[#5B6475]">· {fmt(i.count)} سجل</span>
                </div>
                <p className="m-0 text-[13px] text-[#5B6475]">{i.hint}</p>
                {i.fix && <p className="m-0 text-xs text-[#1D4ED8]">إصلاح تلقائي: {i.fix}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <a href={`/tpa?entity=${i.entityId}&completeness=issue:${i.key}`} className={btn.ghost}><Icon name="table" size={16} />عرض في المراجعة</a>
                {i.fix && <button type="button" disabled={busy} onClick={() => setConfirm(i)} className={btn.primary}><Icon name="check" size={16} />إصلاح</button>}
              </div>
            </div>
          ))}
        </section>
      ))}

      {confirm && (
        <Dialog title="تأكيد الإصلاح" onClose={() => setConfirm(null)}>
          <p className="m-0"><b>{confirm.entity}</b> · {confirm.title} ({fmt(confirm.count)} سجل)</p>
          <p className="m-0 text-[13px] text-[#344054]">{confirm.fix}</p>
          <p className="m-0 text-[13px] text-[#5B6475]">يُسجَّل كل تغيير في سجل التغييرات. يُستحسن «عرض في المراجعة» أولًا للتأكد.</p>
          <div className="flex gap-2">
            <button type="button" onClick={fix} className={btn.primary}><Icon name="check" />إصلاح</button>
            <button type="button" onClick={() => setConfirm(null)} className={btn.ghost}>إلغاء</button>
          </div>
        </Dialog>
      )}
    </>
  );
}
