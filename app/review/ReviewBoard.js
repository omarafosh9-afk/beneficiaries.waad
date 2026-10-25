'use client';
// لوحة المراجعة بوضعين:
//  - mode="entity": شاشة جهة العمل (اعتماد وتعديل، مجمّعة حسب العائلة).
//  - mode="tpa": شاشة الشركة (كل الجهات، إعادة للتعديل، ترحيل الجاهز للمطبعة).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  STATUS, LOCKED, missingOf, Icon, StatusBadge, Photo, Checkbox, Prev, Dialog, btn, relLabel, dobText, isReady,
  records, membersLabel, cardsLabel,
} from './ui';
import {
  previewApprovalAction, approveAction, returnAction, previewForwardAction, forwardAction,
} from './actions';
import EditDrawer from './EditDrawer';

const ENTITIES = [
  { id: 1, name: 'الاسمنت' },
  { id: 2, name: 'جليانة' },
  { id: 3, name: 'الجمارك' },
];
const TABS = {
  entity: ['all', 'pending', 'needs_edit', 'correct', 'modified', 'forwarded'],
  tpa: ['all', 'pending', 'needs_edit', 'modified', 'correct', 'ready', 'forwarded', 'printed', 'delivered'],
};
const READY_TAB = { label: 'جاهز للترحيل', bg: '#E7F6EC', fg: '#126B33' };

export default function ReviewBoard({ mode, user }) {
  const isTpa = mode === 'tpa';
  const fixedEntity = user.role === 'entity' ? user.entityId : null;
  const [entity, setEntity] = useState(fixedEntity || 2);
  const [tab, setTab] = useState('all');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [relation, setRelation] = useState('');
  const [completeness, setCompleteness] = useState('');
  const [intake, setIntake] = useState('');
  const [benStatus, setBenStatus] = useState('');
  const [grouped, setGrouped] = useState(!isTpa);
  const [view, setView] = useState('table');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ key: 'job', dir: 'asc' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sel, setSel] = useState(() => new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [dialog, setDialog] = useState(null); // {kind, ...}
  const [editing, setEditing] = useState(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  const [reloadKey, setReloadKey] = useState(0);
  // زر الترحيل يُعرض في رأس الصفحة بجانب أزرار التنقل.
  const [headerSlot, setHeaderSlot] = useState(null);
  useEffect(() => setHeaderSlot(document.getElementById('header-actions')), []);

  // تذكّر الجهة المختارة (لحساب TPA في شاشة الجهة).
  useEffect(() => {
    if (fixedEntity) return;
    try {
      const v = Number(localStorage.getItem('review.entity'));
      if ([1, 2, 3].includes(v)) setEntity(v);
    } catch {}
  }, [fixedEntity, isTpa]);

  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const filter = useMemo(
    () => ({ entityId: entity || null, tab, q, relation, completeness, intake, benStatus, grouped, sort: sort.key, dir: sort.dir }),
    [entity, tab, q, relation, completeness, intake, benStatus, grouped, sort]
  );

  // أي تغيير في الفلاتر يعيد للصفحة الأولى ويلغي التحديد.
  useEffect(() => {
    setPage(1);
    setSel(new Set());
    setAllMatching(false);
  }, [filter]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (filter.entityId) p.set('entity', filter.entityId);
    p.set('tab', tab);
    if (q) p.set('q', q);
    if (relation) p.set('relation', relation);
    if (completeness) p.set('completeness', completeness);
    if (intake) p.set('intake', intake);
    if (benStatus) p.set('benStatus', benStatus);
    p.set('grouped', grouped ? '1' : '0');
    p.set('sort', sort.key);
    p.set('dir', sort.dir);
    return p;
  }, [filter, tab, q, relation, completeness, intake, benStatus, grouped, sort]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const p = new URLSearchParams(query);
    p.set('page', page);
    fetch(`/api/review?${p}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'تعذّر تحميل البيانات');
        if (alive) {
          setData(j);
          setError('');
        }
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [query, page, reloadKey]);

  const say = useCallback((msg) => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(''), 4000);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const reload = () => setReloadKey((k) => k + 1);

  const rows = useMemo(() => (data ? (data.families ? data.families.flatMap((f) => f.members) : data.rows) : []), [data]);
  const canSelect = useCallback((m) => (isTpa ? isReady(m) : !LOCKED.has(m.status)), [isTpa]);
  const selectable = rows.filter(canSelect);
  const allVisSel = selectable.length > 0 && selectable.every((m) => sel.has(m.id));

  const toggle = (ids, on) => {
    setAllMatching(false);
    setSel((prev) => {
      const next = new Set(prev);
      for (const id of ids) (on ? next.add(id) : next.delete(id));
      return next;
    });
  };
  const toggleMany = (list) => {
    const ids = list.filter(canSelect).map((m) => m.id);
    toggle(ids, !(ids.length && ids.every((id) => sel.has(id))));
  };

  const target = allMatching ? { filter: { ...filter } } : { ids: [...sel] };
  const selCount = allMatching ? null : sel.size;

  async function openApprove(t = target) {
    const r = await previewApprovalAction(t);
    if (!r.ok) return say(r.error);
    setDialog({ kind: 'approve', target: t, counts: r.counts });
  }
  async function doApprove() {
    const r = await approveAction(dialog.target);
    setDialog(null);
    if (!r.ok) return say(r.error);
    setSel(new Set());
    setAllMatching(false);
    say(`تم الاعتماد: ${records(r.result.approved)}${r.result.incompleteCount ? ` — لم يُعتمد ${records(r.result.incompleteCount)} لنقص البيانات` : ''}`);
    reload();
  }
  async function approveOne(m) {
    const r = await approveAction({ ids: [m.id] });
    if (!r.ok) return say(r.error);
    if (!r.result.approved) return say(r.result.incomplete.length ? `لا يمكن اعتماد ${m.name}: ينقصه ${r.result.incomplete[0].missing.join(' و')}` : `لم يُعتمد ${m.name}`);
    say(`تم اعتماد بيانات ${m.name} كما هي`);
    reload();
  }
  async function openForward() {
    const r = await previewForwardAction(target);
    if (!r.ok) return say(r.error);
    setDialog({ kind: 'forward', target, preview: r.preview });
  }
  async function doForward() {
    const r = await forwardAction(dialog.target);
    setDialog(null);
    if (!r.ok) return say(r.error);
    setSel(new Set());
    setAllMatching(false);
    say(`تم الترحيل للمطبعة: ${r.batches.map((b) => `دفعة ${b.id} (${b.entity}: ${cardsLabel(b.count)})`).join('، ')}`);
    reload();
  }
  async function doReturn() {
    const r = await returnAction(dialog.member.id, dialog.note);
    if (!r.ok) return setDialog({ ...dialog, error: r.error });
    setDialog(null);
    say(`أُعيد السجل لجهة العمل: ${dialog.member.name}`);
    reload();
  }

  const tabs = TABS[mode].map((k) => {
    const meta = k === 'all' ? { label: 'الكل', bg: '#EEF1F5', fg: '#344054' } : k === 'ready' ? READY_TAB : STATUS[k];
    return { key: k, label: meta.label, soft: meta, count: data?.counts?.[k] ?? 0 };
  });
  const progress = data?.progress || { done: 0, total: 0 };
  const pct = progress.total ? Math.round((progress.done * 100) / progress.total) : 0;
  const entityName = ENTITIES.find((e) => e.id === Number(entity))?.name;

  const exportHref = `/api/review/export?${query}`;

  return (
    <div className="flex flex-col gap-3">
      {!isTpa && (
        <section className="bg-white border border-[#E3E8EF] rounded-xl px-3 py-2 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
            {!fixedEntity && (
              <label className="flex items-center gap-2 font-semibold">
                جهة العمل
                <select value={entity} onChange={(e) => {
                  setEntity(Number(e.target.value));
                  try { localStorage.setItem('review.entity', e.target.value); } catch {}
                }} className="h-10 px-3 border border-[#D5DCE6] rounded-[10px] bg-white">
                  {ENTITIES.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </label>
            )}
            <span className="font-bold">تقدّم المراجعة</span>
            <span className="text-[#5B6475]">تمت مراجعة {progress.done.toLocaleString('en')} من {progress.total.toLocaleString('en')}</span>
            <div className="flex-[1_1_240px] max-w-[480px] h-2 rounded-full bg-[#EEF1F5] overflow-hidden">
              <div className="h-full bg-[#1D4ED8] rounded-full" style={{ width: `${pct}%` }} />
            </div>
            <span className="font-bold text-[#1D4ED8]">{pct}%</span>
          </div>
          <Tabs tabs={tabs} tab={tab} setTab={setTab} />
        </section>
      )}

      {isTpa && (
        <>
          <section className="bg-white border border-[#E3E8EF] rounded-xl px-3 py-2">
            <div className="overflow-x-auto">
              <Tabs tabs={tabs} tab={tab} setTab={setTab} nowrap />
            </div>
            {headerSlot && createPortal(
              <button type="button" className={`${btn.primary} shrink-0 whitespace-nowrap`} disabled={!allMatching && !sel.size} onClick={openForward}>
                <Icon name="send" />ترحيل المحدد للمطبعة {selCount === null ? '(كل المطابق)' : `(${selCount})`}
              </button>,
              headerSlot
            )}
          </section>
        </>
      )}

      <section className="bg-white border border-[#E3E8EF] rounded-2xl overflow-hidden">
        <div className="flex flex-wrap items-end gap-2 px-3 py-2 border-b border-[#EEF1F5]">
          <Field label="بحث" grow>
            <div className="relative">
              <Icon name="search" className="absolute top-[13px] right-3 text-[#5B6475]" />
              <input type="search" value={qInput} onChange={(e) => setQInput(e.target.value)}
                placeholder="الاسم أو الرقم الوظيفي أو رقم البطاقة"
                className="w-full h-10 pr-10 pl-3 border border-[#D5DCE6] rounded-[10px] bg-white" />
            </div>
          </Field>
          {isTpa && (
            <Field label="جهة العمل" width="w-40">
              <select value={entity} onChange={(e) => {
                setEntity(Number(e.target.value));
                try { localStorage.setItem('review.entity', e.target.value); } catch {}
              }} className="h-10 px-3 border border-[#D5DCE6] rounded-[10px] bg-white">
                {ENTITIES.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="صلة القرابة" width="w-36">
            <select value={relation} onChange={(e) => setRelation(e.target.value)} className="h-10 px-3 border border-[#D5DCE6] rounded-[10px] bg-white">
              <option value="">الكل</option>
              <option value="موظف أساسي">موظف</option>
              <option value="زوجة">زوجة</option>
              <option value="زوج">زوج</option>
              <option value="ابن">ابن</option>
              <option value="ابنة">ابنة</option>
              <option value="أب">أب</option>
              <option value="أم">أم</option>
            </select>
          </Field>
          <Field label="حالة المستفيد" width="w-32">
            <select value={benStatus} onChange={(e) => setBenStatus(e.target.value)} className="h-10 px-3 border border-[#D5DCE6] rounded-[10px] bg-white">
              <option value="">الكل</option>
              <option value="نشط">نشط</option>
              <option value="موقوف">موقوف</option>
              <option value="مكتمل">مكتمل</option>
            </select>
          </Field>
          <Field label="اكتمال البيانات" width="w-48">
            <select value={completeness} onChange={(e) => setCompleteness(e.target.value)} className="h-10 px-3 border border-[#D5DCE6] rounded-[10px] bg-white">
              <option value="">الكل</option>
              <option value="complete">مكتملة</option>
              <option value="missing">أي نقص (صورة أو مواليد)</option>
              <option value="no_photo">نقص صورة</option>
              <option value="no_dob">نقص مواليد</option>
              <option value="no_employee">نقص الموظف (الاسم أو الرقم الوظيفي)</option>
            </select>
          </Field>
          {!!data?.intakeBatches?.length && (
            <Field label="دفعة القائمة" width="w-40">
              <select value={intake} onChange={(e) => setIntake(e.target.value)} className="h-10 px-3 border border-[#D5DCE6] rounded-[10px] bg-white">
                <option value="">الكل</option>
                {data.intakeBatches.map((b) => <option key={b} value={b}>{b === 1 ? 'الدفعة الأولى' : `الدفعة ${b}`}</option>)}
              </select>
            </Field>
          )}
          <label className="flex items-center gap-2 h-10 px-3 border border-[#D5DCE6] rounded-[10px] bg-white cursor-pointer text-[13px] font-medium whitespace-nowrap">
            <input type="checkbox" checked={grouped} onChange={() => setGrouped(!grouped)} className="w-[18px] h-[18px] m-0 accent-[#1D4ED8]" />
            تجميع حسب العائلة
          </label>
          {!isTpa && (
            <div className="flex gap-0.5 p-0.5 border border-[#D5DCE6] rounded-xl bg-white">
              {[['table', 'جدول', 'table'], ['cards', 'كروت', 'grid']].map(([k, label, icon]) => (
                <button key={k} type="button" onClick={() => setView(k)} aria-pressed={view === k}
                  className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13px] font-semibold ${view === k ? 'bg-[#1D4ED8] text-white' : 'bg-white text-[#344054]'}`}>
                  <Icon name={icon} />{label}
                </button>
              ))}
            </div>
          )}
          <a href={exportHref} className={btn.ghost}><Icon name="download" />تصدير</a>
          {isTpa ? null : (
            <button type="button" className={btn.primary} disabled={!allMatching && !sel.size} onClick={() => openApprove()}>
              <Icon name="check" strokeWidth={2.4} />اعتماد المحدد {selCount === null ? '(كل المطابق)' : `(${selCount})`}
            </button>
          )}
        </div>

        {allVisSel && (
          <div aria-live="polite" className="flex flex-wrap items-center gap-x-3 px-5 bg-[#F5F8FF] border-b border-[#DCE6FB] text-[#1E3A8A]">
            <span>
              {allMatching
                ? `تم تحديد كل السجلات المطابقة للفلتر في جميع الصفحات${isTpa ? ' (يُرحَّل الجاهز منها فقط)' : ''}.`
                : `تم تحديد كل السجلات الظاهرة في هذه الصفحة: ${selectable.length}`}
            </span>
            {!allMatching && data?.totalPages > 1 && (
              <button type="button" onClick={() => setAllMatching(true)} className="h-11 px-2 font-bold text-[#1D4ED8] underline">
                تحديد كل السجلات المطابقة للفلتر
              </button>
            )}
            <button type="button" onClick={() => { setSel(new Set()); setAllMatching(false); }} className="h-11 px-2 font-semibold text-[#344054]">
              إلغاء التحديد
            </button>
          </div>
        )}

        {error && <p role="alert" className="m-0 px-5 py-4 text-[#B42318] font-semibold">{error}</p>}

        {data && !rows.length && !loading && (
          <p className="m-0 py-12 px-5 text-center text-[#5B6475]">لا توجد سجلات مطابقة للبحث أو الفلتر الحالي.</p>
        )}

        {!!rows.length && view === 'table' && (
          <Table
            sort={sort} onSort={(key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))}
            isTpa={isTpa} grouped={!!data.families} data={data} sel={sel} canSelect={canSelect}
            allVisSel={allVisSel} noneSelectable={!selectable.length}
            onToggleAll={() => toggleMany(rows)} onToggle={(m) => toggle([m.id], !sel.has(m.id))}
            onToggleFamily={(f) => toggleMany(f.members)}
            onApproveFamily={(f) => openApprove({ ids: f.members.filter((m) => !LOCKED.has(m.status)).map((m) => m.id) })}
            onApprove={approveOne} onEdit={setEditing}
            onReturn={(m) => setDialog({ kind: 'return', member: m, note: '' })}
          />
        )}
        {!!rows.length && view === 'cards' && !isTpa && (
          <div className="grid gap-4 p-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))' }}>
            {rows.map((m) => (
              <article key={m.id} className={`border rounded-[14px] p-3.5 flex flex-col gap-2.5 ${sel.has(m.id) ? 'border-[#8FB0EE] bg-[#F5F8FF]' : 'border-[#E3E8EF] bg-white'}`}>
                <div className="flex items-center justify-between">
                  <Checkbox checked={sel.has(m.id)} disabled={!canSelect(m)} onChange={() => toggle([m.id], !sel.has(m.id))} label={`تحديد ${m.name}`} />
                  <StatusBadge status={m.status} small />
                </div>
                <div className="flex justify-center"><Photo m={m} size="lg" /></div>
                <div className="flex flex-col items-center gap-0.5 text-center">
                  <span className={`font-bold ${m.prev.name !== undefined ? 'text-[#1D4ED8]' : ''}`}>{m.name}</span>
                  <span className="text-[13px] text-[#5B6475]">{relLabel(m.relation)} · <span dir="ltr">{dobText(m.dob) || '—'}</span></span>
                  <span dir="ltr" className="font-mono text-[13px] text-[#344054]">{m.card}</span>
                  <span className="text-xs text-[#5B6475]">الرقم الوظيفي {m.jobNo || '—'}</span>
                </div>
                {m.status === 'needs_edit' && m.note && <span className="text-xs font-semibold text-[#B54708] text-center">ملاحظة TPA: {m.note}</span>}
                <RowActions m={m} isTpa={false} onApprove={approveOne} onEdit={setEditing} />
              </article>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-[#EEF1F5] text-[13px] text-[#5B6475]">
          <span>
            {loading ? 'جارٍ التحميل…' : data ? `${data.families ? 'عائلات' : 'سجلات'}: ${data.total.toLocaleString('en')}${data.totalPages > 1 ? ` — صفحة ${data.page} من ${data.totalPages}` : ''}` : ''}
            {isTpa && ' · يُرحَّل فقط ما حالته «صحيح» أو «معدل» وبياناته مكتملة'}
          </span>
          {data?.totalPages > 1 && (
            <div className="flex items-center gap-1.5">
              <button type="button" aria-label="الصفحة السابقة" disabled={page <= 1} onClick={() => setPage(page - 1)} className={`${btn.ghost} w-11 justify-center px-0`}><Icon name="right" /></button>
              <span className="min-w-11 h-11 px-2 rounded-[10px] bg-[#1D4ED8] text-white flex items-center justify-center font-bold">{page}</span>
              <button type="button" aria-label="الصفحة التالية" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)} className={`${btn.ghost} w-11 justify-center px-0`}><Icon name="left" /></button>
            </div>
          )}
        </div>
      </section>

      {dialog?.kind === 'approve' && (
        <Dialog title="اعتماد السجلات المحددة" onClose={() => setDialog(null)}>
          <Count bg="#E7F6EC" fg="#126B33" label="ستُعتمد وتصبح «صحيح»" n={dialog.counts.approve} />
          {!!dialog.counts.incompleteCount && (
            <div className="flex flex-col gap-2 px-3.5 py-3 rounded-[10px] bg-[#FEECEB] text-[#B42318]">
              <div className="flex items-center justify-between gap-3 font-semibold"><span>لن تُعتمد لنقص البيانات — أكملها أولًا من «تعديل»</span><span className="text-lg font-bold">{dialog.counts.incompleteCount}</span></div>
              <ul className="m-0 pr-4 text-[13px] max-h-48 overflow-y-auto flex flex-col gap-1">
                {dialog.counts.incomplete.map((x) => <li key={x.id}><b>{x.name}</b>: ينقصه {x.missing.join(' و')}</li>)}
                {dialog.counts.incompleteCount > dialog.counts.incomplete.length && <li>و{dialog.counts.incompleteCount - dialog.counts.incomplete.length} غيرها…</li>}
              </ul>
            </div>
          )}
          {!!dialog.counts.needs && <Count bg="#FFF1E5" fg="#B54708" label="لن تُعتمد لأنها «يحتاج تعديل» — تُعدَّل أولًا" n={dialog.counts.needs} />}
          {!!dialog.counts.same && <Count bg="#F2F4F7" fg="#344054" label="بلا تغيير (صحيحة أو معدلة أو مقفلة)" n={dialog.counts.same} />}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn.primary} disabled={!dialog.counts.approve} onClick={doApprove}><Icon name="check" strokeWidth={2.4} />تأكيد الاعتماد</button>
            <button type="button" className={btn.ghost} onClick={() => setDialog(null)}>إلغاء</button>
          </div>
        </Dialog>
      )}

      {dialog?.kind === 'forward' && (
        <Dialog title="إنشاء دفعات طباعة" onClose={() => setDialog(null)} wide>
          <p className="m-0 text-[#5B6475]">كل جهة عمل في دفعة مستقلة لأن لكل جهة تصميم بطاقة خاص.</p>
          {dialog.preview.groups.map((g) => (
            <Count key={g.entity} bg="#F1ECFE" fg="#4C1D95" label={g.entity} n={cardsLabel(g.count)} />
          ))}
          {!!dialog.preview.notReady && <Count bg="#FFF1E5" fg="#B54708" label="غير جاهزة ولن تُرحَّل" n={dialog.preview.notReady} />}
          <p className="m-0 text-[13px] text-[#344054]">بعد الترحيل تُقفل السجلات عن التعديل.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn.primary} disabled={!dialog.preview.ready} onClick={doForward}><Icon name="send" />تأكيد الترحيل</button>
            <button type="button" className={btn.ghost} onClick={() => setDialog(null)}>إلغاء</button>
          </div>
        </Dialog>
      )}

      {dialog?.kind === 'return' && (
        <Dialog title="إعادة السجل لجهة العمل" onClose={() => setDialog(null)}>
          <p className="m-0 text-[#344054]"><b>{dialog.member.name}</b> · {dialog.member.entity}</p>
          <label className="flex flex-col gap-1.5 font-semibold text-[#344054]">
            <span>ما الذي يجب تعديله؟ <span className="text-[#B42318]">*</span></span>
            <textarea rows={3} value={dialog.note} maxLength={300} onChange={(e) => setDialog({ ...dialog, note: e.target.value, error: '' })}
              placeholder="مثال: الصورة غير واضحة، يرجى رفع صورة حديثة" className="px-3 py-1.5 border border-[#D5DCE6] rounded-[10px] font-normal" />
          </label>
          {dialog.error && <p role="alert" className="m-0 text-[#B42318] font-semibold">{dialog.error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={doReturn} className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[13px] bg-[#B54708] text-white font-semibold"><Icon name="undo" />إعادة مع الملاحظة</button>
            <button type="button" className={btn.ghost} onClick={() => setDialog(null)}>إلغاء</button>
          </div>
        </Dialog>
      )}

      {editing && (
        <EditDrawer m={editing} onClose={() => setEditing(null)} onSaved={() => {
          setEditing(null);
          say('حُفظ التعديل وأصبحت الحالة «معدل»، وتراه شركة TPA مع القيمة القديمة');
          reload();
        }} />
      )}

      <div aria-live="polite" className="fixed bottom-6 inset-x-0 z-[60] flex justify-center px-4 pointer-events-none">
        {toast && <div className="max-w-[680px] bg-[#101828] text-white rounded-xl px-[18px] py-3 shadow-lg font-medium">{toast}</div>}
      </div>

      {entityName && !isTpa && <span className="sr-only">جهة العمل: {entityName}</span>}
    </div>
  );
}

function Field({ label, children, grow, width }) {
  return (
    <label className={`flex flex-col gap-1.5 text-xs font-semibold text-[#344054] ${grow ? 'flex-[1_1_260px] min-w-0' : width || ''}`}>
      {label}
      <span className="text-sm font-normal flex flex-col">{children}</span>
    </label>
  );
}

function Tabs({ tabs, tab, setTab, nowrap }) {
  return (
    <nav aria-label="تصفية حسب الحالة" className={`flex gap-2 ${nowrap ? 'flex-nowrap' : 'flex-wrap'}`}>
      {tabs.map((t) => {
        const on = tab === t.key;
        return (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} aria-pressed={on}
            className={`inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 h-8 px-3 rounded-full border text-[13px] font-semibold ${on ? 'bg-[#1D4ED8] text-white border-[#1D4ED8]' : 'bg-white text-[#344054] border-[#D5DCE6]'}`}>
            {t.label}
            <span className="min-w-[22px] px-1.5 rounded-full text-[11px] font-bold leading-[18px] text-center"
              style={on ? { background: '#FFFFFF', color: '#1D4ED8' } : { background: t.soft.bg, color: t.soft.fg }}>
              {t.count.toLocaleString('en')}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function Count({ bg, fg, label, n }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-[10px] font-semibold" style={{ background: bg, color: fg }}>
      <span>{label}</span>
      <span className="text-lg font-bold">{n}</span>
    </div>
  );
}

function Batches({ batches }) {
  return (
    <section aria-labelledby="batches-title" className="bg-white border border-[#E3E8EF] rounded-2xl px-5 py-[18px] flex flex-col gap-3.5">
      <h2 id="batches-title" className="m-0 text-base font-bold">دفعات الطباعة</h2>
      {!batches.length ? (
        <p className="m-0 text-[#5B6475] text-sm">لا توجد دفعات بعد. حدّد السجلات الجاهزة ثم «ترحيل المحدد للمطبعة».</p>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))' }}>
          {batches.map((b) => {
            const state = b.delivered === b.total ? ['مُسلَّمة', '#1F2937', '#FFFFFF'] : b.printed === b.total ? ['مطبوعة', '#E6F6F4', '#0F766E'] : ['لدى المطبعة', '#F1ECFE', '#6D28D9'];
            return (
              <div key={b.id} className="border border-[#E3E8EF] rounded-xl p-3.5 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold">دفعة {b.id} · {b.entity}</span>
                  <span className="inline-flex items-center h-[26px] px-2.5 rounded-full text-xs font-bold" style={{ background: state[1], color: state[2] }}>{state[0]}</span>
                </div>
                <span className="text-[13px] text-[#5B6475]"><span dir="ltr">{b.created_at.slice(0, 10)}</span> · {cardsLabel(b.total)} · مطبوع {b.printed} من {b.total}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

const COLS = {
  entityGrouped: '56px 84px minmax(220px,2fr) minmax(96px,.8fr) minmax(120px,.9fr) minmax(170px,1.2fr) minmax(150px,1fr) minmax(200px,1.2fr)',
  entityFlat: '56px 84px 104px minmax(170px,1.4fr) minmax(190px,1.6fr) 96px 120px minmax(160px,1fr) minmax(140px,1fr) minmax(190px,1.1fr)',
  tpaGrouped: '56px 84px minmax(220px,2fr) minmax(96px,.8fr) minmax(120px,.9fr) minmax(170px,1.2fr) minmax(170px,1fr) 170px',
  tpaFlat: '56px 84px 92px 96px minmax(160px,1.3fr) minmax(180px,1.5fr) 88px 116px minmax(150px,1fr) minmax(170px,1fr) 170px',
};

const SORTABLE = { 'الرقم الوظيفي': 'job', 'اسم الموظف': 'employee', 'اسم المستفيد': 'name' };

function Table({ sort, onSort, isTpa, grouped, data, sel, canSelect, allVisSel, noneSelectable, onToggleAll, onToggle, onToggleFamily, onApproveFamily, onApprove, onEdit, onReturn }) {
  const cols = COLS[(isTpa ? 'tpa' : 'entity') + (grouped ? 'Grouped' : 'Flat')];
  const minW = grouped ? 1080 : isTpa ? 1300 : 1300;
  const head = grouped
    ? ['الصورة', 'اسم المستفيد', 'صلة القرابة', 'المواليد', 'رقم البطاقة', 'الحالة', 'إجراءات']
    : [...['الصورة'], ...(isTpa ? ['الجهة'] : []), 'الرقم الوظيفي', 'اسم الموظف', 'اسم المستفيد', 'صلة القرابة', 'المواليد', 'رقم البطاقة', 'الحالة', 'إجراءات'];
  const row = (m) => (
    <Row key={m.id} m={m} cols={cols} flat={!grouped} isTpa={isTpa} selected={sel.has(m.id)} selectable={canSelect(m)}
      onToggle={() => onToggle(m)} onApprove={onApprove} onEdit={onEdit} onReturn={onReturn} />
  );
  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: minW }}>
        <div className="grid items-center min-h-12 bg-[#F8FAFC] border-b border-[#E3E8EF] text-[#344054] text-[13px] font-semibold" style={{ gridTemplateColumns: cols }}>
          <div className="flex justify-center">
            <Checkbox checked={allVisSel} disabled={noneSelectable} onChange={onToggleAll} label="تحديد كل السجلات الظاهرة" />
          </div>
          {head.map((h) => {
            // في العرض المجمّع يرتّب «اسم المستفيد» العائلات حسب اسم الموظف.
            const key = SORTABLE[h];
            if (!key) return <div key={h} className="px-3">{h}</div>;
            const on = sort.key === key || (grouped && key === 'name' && sort.key === 'employee');
            return (
              <div key={h} className="px-1.5" aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button type="button" onClick={() => onSort(key)} title="فرز حسب هذا العمود"
                  className={`inline-flex items-center gap-1 h-8 px-1.5 rounded-md hover:bg-[#EEF1F5] font-semibold ${on ? 'text-[#1D4ED8]' : ''}`}>
                  {h}
                  <span aria-hidden="true" className="text-[10px]">{on ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                </button>
              </div>
            );
          })}
        </div>
        {grouped
          ? data.families.map((f) => {
              const ids = f.members.filter(canSelect).map((m) => m.id);
              const pending = f.members.filter((m) => m.status === 'pending').length;
              const needs = f.members.filter((m) => m.status === 'needs_edit').length;
              const incomplete = f.members.filter((m) => m.status === 'pending' && missingOf(m).length).length;
              const summary = [pending && `بانتظار التحقق: ${pending}`, incomplete && `ناقص بيانات: ${incomplete}`, needs && `يحتاج تعديل: ${needs}`,
                f.members.every((m) => LOCKED.has(m.status)) && 'مرحّلة للمطبعة'].filter(Boolean).join(' · ');
              return (
                <div key={f.key}>
                  <div className="grid items-center min-h-[48px] bg-[#F8FAFC] border-b border-[#E3E8EF]" style={{ gridTemplateColumns: '56px minmax(0,1fr) auto' }}>
                    <div className="flex justify-center">
                      <Checkbox checked={ids.length > 0 && ids.every((id) => sel.has(id))} disabled={!ids.length} onChange={() => onToggleFamily(f)} label={`تحديد عائلة ${f.employeeName}`} />
                    </div>
                    <div className="flex flex-wrap items-baseline gap-x-[18px] gap-y-1 px-3 py-2 min-w-0">
                      {isTpa && <span className="inline-flex h-[26px] items-center px-2.5 rounded-lg bg-[#F2F4F7] text-xs font-semibold">{f.entity}</span>}
                      <span className="flex items-baseline gap-1.5"><span className="text-xs text-[#5B6475]">الرقم الوظيفي</span><span dir="ltr" className="font-mono font-medium">{f.jobNo || '—'}</span></span>
                      <span className="flex items-baseline gap-1.5"><span className="text-xs text-[#5B6475]">اسم الموظف</span><span className="font-bold">{f.employeeName || '—'}</span></span>
                      <span className="text-[#5B6475]">{membersLabel(f.members.length)}</span>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 px-4 py-2">
                      <span className="text-[13px] text-[#5B6475]">{summary}</span>
                      {!isTpa && pending > 0 && (
                        <button type="button" onClick={() => onApproveFamily(f)} className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-[13px] border border-[#A9C2F2] bg-white hover:bg-[#F2F4F7] text-[#1D4ED8] font-semibold">
                          <Icon name="check" size={16} strokeWidth={2.4} />اعتماد العائلة
                        </button>
                      )}
                    </div>
                  </div>
                  {f.members.map(row)}
                </div>
              );
            })
          : data.rows.map(row)}
      </div>
    </div>
  );
}

function Row({ m, cols, flat, isTpa, selected, selectable, onToggle, onApprove, onEdit, onReturn }) {
  const changed = (k) => m.prev[k] !== undefined;
  return (
    <div className={`grid items-center min-h-[60px] border-b border-[#EEF1F5] ${selected ? 'bg-[#F5F8FF]' : 'bg-white'}`} style={{ gridTemplateColumns: cols }}>
      <div className="flex justify-center"><Checkbox checked={selected} disabled={!selectable} onChange={onToggle} label={`تحديد ${m.name}`} /></div>
      <div className="px-3 py-1.5"><Photo m={m} /></div>
      {flat && isTpa && <div className="px-3"><span className="inline-flex h-[26px] items-center px-2.5 rounded-lg bg-[#F2F4F7] text-xs font-semibold whitespace-nowrap">{m.entity}</span></div>}
      {flat && <div className="px-3"><span dir="ltr" className="font-mono text-[13px] text-[#344054]">{m.jobNo || '—'}</span></div>}
      {flat && <div className="px-3 text-[#344054]">{m.employeeName || '—'}</div>}
      <div className="px-3 py-1.5 min-w-0 flex flex-col gap-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className={`font-semibold ${changed('name') ? 'text-[#1D4ED8]' : ''}`}>{m.name}</span>
          {m.benStatus && m.benStatus !== 'نشط' && (
            <span className={`inline-flex h-5 items-center px-1.5 rounded text-[11px] font-bold ${m.benStatus === 'موقوف' ? 'bg-[#FEECEB] text-[#B42318]' : 'bg-[#EEF1F5] text-[#475467]'}`}>{m.benStatus}</span>
          )}
        </span>
        {changed('name') && <Prev value={m.prev.name} />}
        {m.status === 'needs_edit' && m.note && (
          <span className="flex items-start gap-1.5 text-xs font-semibold text-[#B54708]"><Icon name="alert" size={14} className="mt-0.5" />{isTpa ? 'ملاحظة أُرسلت' : 'ملاحظة TPA'}: {m.note}</span>
        )}
        {m.status === 'modified' && m.reason && <span className="text-xs text-[#1D4ED8]">سبب التعديل: {m.reason}</span>}
      </div>
      <div className="px-3 py-1.5 flex flex-col gap-0.5">
        <span className={changed('relation') ? 'text-[#1D4ED8]' : 'text-[#344054]'}>{relLabel(m.relation)}</span>
        {changed('relation') && <Prev value={relLabel(m.prev.relation)} />}
      </div>
      <div className="px-3 py-1.5 flex flex-col items-start gap-0.5">
        {m.dob ? (
          <span dir="ltr" className={`tabular-nums ${changed('dob') ? 'text-[#1D4ED8]' : 'text-[#344054]'}`}>{dobText(m.dob)}</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[#B54708] font-bold"><Icon name="alert" size={14} />ناقص</span>
        )}
        {/^\d{4}$/.test(m.dob) && <span className="text-xs text-[#5B6475]">سنة فقط</span>}
        {changed('dob') && <Prev value={dobText(m.prev.dob)} ltr />}
      </div>
      <div className="px-3 py-1.5"><span dir="ltr" className="font-mono text-[13px] text-[#344054]">{m.card}</span></div>
      <div className="px-3 py-1.5 flex flex-col items-start gap-1">
        <StatusBadge status={m.status} />
        {m.batch && <span className="text-xs text-[#5B6475]">دفعة الطباعة {m.batch}</span>}
        {!isTpa && m.status === 'pending' && missingOf(m).length > 0 && (
          <span className="text-xs font-semibold text-[#B42318]">ناقص: {missingOf(m).join('، ')}</span>
        )}
        {isTpa && (m.status === 'correct' || m.status === 'modified') && !isReady(m) && (
          <span className="text-xs font-semibold text-[#B54708]">غير جاهز: {!m.photoUrl ? 'بلا صورة' : 'المواليد ناقصة'}</span>
        )}
      </div>
      <div className="px-3 py-1.5"><RowActions m={m} isTpa={isTpa} onApprove={onApprove} onEdit={onEdit} onReturn={onReturn} /></div>
    </div>
  );
}

function RowActions({ m, isTpa, onApprove, onEdit, onReturn }) {
  if (LOCKED.has(m.status)) {
    return <span className="inline-flex items-center gap-1.5 text-[13px] text-[#5B6475]"><Icon name="lock" size={15} />مقفل بعد الترحيل</span>;
  }
  if (isTpa) {
    if (m.status === 'correct' || m.status === 'modified') {
      return <button type="button" onClick={() => onReturn(m)} className={btn.warn}><Icon name="undo" size={16} />إعادة للتعديل</button>;
    }
    return <span className="text-[13px] text-[#5B6475]">{m.status === 'pending' ? 'بانتظار جهة العمل' : 'لدى جهة العمل للتعديل'}</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {m.status === 'pending' && (
        <button type="button" onClick={() => onApprove(m)} className={`${btn.approve} disabled:opacity-40 disabled:cursor-not-allowed`}
          disabled={missingOf(m).length > 0} title={missingOf(m).length ? `لا يمكن الاعتماد: ينقصه ${missingOf(m).join(' و')}` : undefined}><Icon name="check" size={16} strokeWidth={2.4} />صحيح</button>
      )}
      <button type="button" onClick={() => onEdit(m)}
        className={`inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-[13px] border bg-white hover:bg-[#F2F4F7] font-semibold ${m.status === 'needs_edit' ? 'border-[#F0B27A] text-[#B54708]' : 'border-[#D5DCE6] text-[#344054]'}`}>
        <Icon name="pencil" size={16} />تعديل
      </button>
    </div>
  );
}
