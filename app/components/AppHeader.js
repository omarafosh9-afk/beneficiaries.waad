// رأس الصفحات: العنوان، والتنقل حسب الدور، والمستخدم الحالي وتسجيل الخروج.
import Link from 'next/link';
import { logout } from '../login/actions';
import { ROLE_LABELS } from '../../lib/auth.js';

export default function AppHeader({ user, title, subtitle, active }) {
  const links = user.role === 'tpa'
    ? [['/tpa', 'المراجعة والترحيل'], ['/', 'البحث والصور'], ['/users', 'المستخدمون']]
    : [];
  // أول حرف من الاسم الظاهر فقط (الجمع بين حرف عربي وآخر لاتيني كان يظهر مقلوبًا).
  const initials = Array.from(user.displayName.replace(/[^\p{L}\s]/gu, '').trim())[0] || '؟';
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <h1 className="m-0 text-2xl font-bold leading-snug">{title}</h1>
        {subtitle && <p className="m-0 text-[#5B6475]">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        {links.map(([href, label]) => (
          <Link key={href} href={href} aria-current={active === href ? 'page' : undefined}
            className={`inline-flex items-center h-11 px-3.5 rounded-xl border font-semibold ${active === href ? 'bg-[#1D4ED8] border-[#1D4ED8] text-white' : 'bg-white border-[#E3E8EF] text-[#344054] hover:bg-[#F2F4F7]'}`}>
            {label}
          </Link>
        ))}
        <div className="flex items-center gap-2.5 h-[52px] px-2.5 rounded-xl border border-[#E3E8EF] bg-white">
          <span aria-hidden="true" className="w-9 h-9 rounded-full bg-[#1D4ED8] text-white flex items-center justify-center font-bold text-[13px]">{initials}</span>
          <span className="flex flex-col leading-tight">
            <span className="font-semibold">{user.displayName}</span>
            <span className="text-xs text-[#5B6475]">{ROLE_LABELS[user.role]}{user.entityName ? ` · ${user.entityName}` : ''}</span>
          </span>
          <form action={logout}>
            <button type="submit" className="h-11 px-3 rounded-[10px] text-[13px] font-semibold text-[#B42318] hover:bg-[#FEECEB]">خروج</button>
          </form>
        </div>
      </div>
    </header>
  );
}
