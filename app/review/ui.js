'use client';
// عناصر عرض صغيرة مشتركة بين شاشة جهة العمل وشاشة الشركة.

export const STATUS = {
  pending: { label: 'بانتظار التحقق', bg: '#EEF1F5', fg: '#475467', icon: 'clock' },
  needs_edit: { label: 'يحتاج تعديل', bg: '#FFF1E5', fg: '#B54708', icon: 'alert' },
  correct: { label: 'صحيح', bg: '#E7F6EC', fg: '#126B33', icon: 'check' },
  modified: { label: 'معدل', bg: '#E8F0FE', fg: '#1D4ED8', icon: 'pencil' },
  forwarded: { label: 'مرحّل', bg: '#F1ECFE', fg: '#6D28D9', icon: 'send' },
  printed: { label: 'مطبوع', bg: '#E6F6F4', fg: '#0F766E', icon: 'check' },
  delivered: { label: 'مُسلَّم', bg: '#1F2937', fg: '#FFFFFF', icon: 'check' },
};
export const LOCKED = new Set(['forwarded', 'printed', 'delivered']);
export const RELATIONS = ['موظف أساسي', 'زوجة', 'زوج', 'ابن', 'ابنة', 'أب', 'أم'];

export function relLabel(r) {
  return r === 'موظف أساسي' ? 'موظف' : r;
}

export function dobText(d) {
  if (!d) return '';
  // العرض دائمًا dd/mm/yyyy (يُكتب من اليسار لليمين في الخلية).
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

export function missingOf(m) {
  const out = [];
  if (!m.photoUrl) out.push('الصورة');
  if (!m.dob) out.push('المواليد');
  return out;
}

export function isReady(m) {
  return (m.status === 'correct' || m.status === 'modified') && !!m.photoUrl && !!m.dob;
}

function countLabel(n, one, two, few, many) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}
export const records = (n) => countLabel(n, 'سجل واحد', 'سجلان', 'سجلات', 'سجلًا');
export const membersLabel = (n) => countLabel(n, 'فرد واحد', 'فردان', 'أفراد', 'فردًا');
export const cardsLabel = (n) => countLabel(n, 'بطاقة واحدة', 'بطاقتان', 'بطاقات', 'بطاقة');

const PATHS = {
  check: <path d="M20 6 9 17l-5-5" />,
  pencil: (
    <>
      <path d="M21.17 6.81a1 1 0 0 0-3.98-3.98L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z" />
      <path d="m15 5 4 4" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  send: (
    <>
      <path d="M14.54 21.69a.5.5 0 0 0 .94-.03l6.5-19a.5.5 0 0 0-.64-.64l-19 6.5a.5.5 0 0 0-.03.94l7.93 3.18a2 2 0 0 1 1.11 1.11z" />
      <path d="m21.85 2.15-10.94 10.93" />
    </>
  ),
  lock: (
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  camera: (
    <>
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" />
      <circle cx="12" cy="13" r="3" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </>
  ),
  upload: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m17 8-5-5-5 5" />
      <path d="M12 3v12" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
      <path d="M3 15h18" />
      <path d="M9 3v18" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  undo: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
  right: <path d="m9 18 6-6-6-6" />,
  left: <path d="m15 18-6-6 6-6" />,
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
};

export function Icon({ name, size = 18, className = '', strokeWidth = 2 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className={`shrink-0 ${className}`}
      fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name]}
    </svg>
  );
}

export function StatusBadge({ status, small }) {
  const s = STATUS[status] || STATUS.pending;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-bold whitespace-nowrap ${small ? 'h-6 px-2 text-[11px]' : 'h-6 px-2 text-[11px]'}`}
      style={{ background: s.bg, color: s.fg }}>
      <Icon name={s.icon} size={13} strokeWidth={s.icon === 'check' ? 2.4 : 2} />
      {s.label}
    </span>
  );
}

export function Photo({ m, size = 'sm' }) {
  const box = size === 'lg' ? 'w-24 h-[116px] rounded-xl' : size === 'md' ? 'w-[72px] h-[88px] rounded-[10px]' : 'w-14 h-[68px] rounded-lg';
  if (m.photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={m.photoUrl} alt={`صورة ${m.name}`} className={`${box} object-cover bg-[#EEF1F5]`} loading="lazy" />;
  }
  return (
    <div className={`${box} border-[1.5px] border-dashed border-[#E8892B] bg-[#FFF8F0] text-[#B54708] flex flex-col items-center justify-center gap-0.5`}>
      <Icon name="camera" size={size === 'sm' ? 16 : 22} />
      <span className="text-[10px] font-bold leading-tight">بلا صورة</span>
    </div>
  );
}

export function Checkbox({ checked, disabled, onChange, label, accent = '#1D4ED8' }) {
  return (
    <label className={`w-11 h-11 flex items-center justify-center ${disabled ? '' : 'cursor-pointer'}`}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={onChange} aria-label={label}
        className="w-[18px] h-[18px] m-0" style={{ accentColor: accent }} />
    </label>
  );
}

export function Prev({ value, ltr }) {
  return (
    <span className="text-xs text-[#5B6475]">
      كان: <s dir={ltr ? 'ltr' : undefined}>{value || 'فارغ'}</s>
    </span>
  );
}

export function Dialog({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 bg-[rgba(16,24,40,0.45)] flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className={`w-full ${wide ? 'max-w-[520px]' : 'max-w-[480px]'} bg-white rounded-2xl p-6 flex flex-col gap-4 shadow-[0_24px_48px_rgba(16,24,40,0.2)]`}>
        <h2 className="m-0 text-lg font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export const btn = {
  primary: 'inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[13px] bg-[#1D4ED8] hover:bg-[#1E40AF] text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed',
  ghost: 'inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13px] border border-[#D5DCE6] bg-white hover:bg-[#F2F4F7] text-[#344054] font-semibold disabled:opacity-50',
  approve: 'inline-flex items-center gap-1 h-8 px-2 rounded-lg text-xs border border-[#A8D5B6] bg-white hover:bg-[#F2F4F7] text-[#126B33] font-semibold whitespace-nowrap',
  warn: 'inline-flex items-center gap-1 h-8 px-2 rounded-lg text-xs border border-[#F0B27A] bg-white hover:bg-[#F2F4F7] text-[#B54708] font-semibold whitespace-nowrap',
  edit: 'inline-flex items-center gap-1 h-8 px-2 rounded-lg text-xs border border-[#D5DCE6] bg-white hover:bg-[#F2F4F7] text-[#344054] font-semibold whitespace-nowrap',
};
