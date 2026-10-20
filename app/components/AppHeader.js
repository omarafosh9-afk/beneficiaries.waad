// رأس الصفحات: العنوان، والتنقل حسب الدور، والمستخدم الحالي وتسجيل الخروج.
import Link from 'next/link';
import { logout } from '../login/actions';
import { ROLE_LABELS } from '../../lib/auth.js';

export default function AppHeader({ user, title, subtitle, active }) {
  const links = user.role === 'tpa'
    ? [['/tpa', 'المراجعة والترحيل'], ['/', 'البحث والصور'], ['/users', 'المستخدمون']]
    : [];
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <h1 className="m-0 text-2xl font-bold leading-snug">{title}</h1>
        {subtitle && <p className="m-0 text-[#5B6475]">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <div id="header-actions" className="contents" />
        {links.map(([href, label]) => (
          <Link key={href} href={href} aria-current={active === href ? 'page' : undefined}
            className={`inline-flex items-center h-9 px-3 rounded-lg border text-[13px] font-semibold ${active === href ? 'bg-[#1D4ED8] border-[#1D4ED8] text-white' : 'bg-white border-[#E3E8EF] text-[#344054] hover:bg-[#F2F4F7]'}`}>
            {label}
          </Link>
        ))}
        <div className="flex items-center gap-2.5 h-12 px-2.5 rounded-xl border border-[#E3E8EF] bg-white">
          <span aria-hidden="true" className="w-9 h-9 rounded-full bg-[#1D4ED8] text-white flex items-center justify-center">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a7 7 0 0 1 16 0v1" /></svg>
          </span>
          <span className="flex flex-col leading-tight">
            <span className="font-semibold">{user.displayName}</span>
            <span className="text-xs text-[#5B6475]">{ROLE_LABELS[user.role]}{user.entityName ? ` · ${user.entityName}` : ''}</span>
          </span>
          <form action={logout}>
            <button type="submit" className="h-8 px-2.5 rounded-lg text-[13px] font-semibold text-[#B42318] hover:bg-[#FEECEB]">خروج</button>
          </form>
        </div>
      </div>
    </header>
  );
}
