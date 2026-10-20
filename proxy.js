// يمنع الوصول لأي صفحة أو بيانات أو صورة قبل تسجيل الدخول.
// (الصلاحيات التفصيلية حسب الدور تُفحص على الخادم في كل مسار وعملية.)
import { NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from './lib/session.js';

export function proxy(request) {
  const ok = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (ok) return NextResponse.next();
  const { pathname } = request.nextUrl;
  if (pathname.startsWith('/api/') || pathname.startsWith('/photos/')) {
    return NextResponse.json({ error: 'يلزم تسجيل الدخول.' }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!login|fonts/|_next/static|_next/image|favicon.ico).*)'],
};
