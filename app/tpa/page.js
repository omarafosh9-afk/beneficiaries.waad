import { redirect } from 'next/navigation';
import { currentUser } from '../../lib/auth.js';
import AppHeader from '../components/AppHeader';
import ReviewBoard from '../review/ReviewBoard';

export const metadata = { title: 'المراجعة والترحيل للمطبعة' };

export default async function TpaPage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=/tpa');
  if (user.role !== 'tpa') redirect('/review');
  return (
    <main className="min-h-screen bg-[#F4F6F9]">
      <div className="max-w-[1360px] mx-auto px-4 md:px-6 pt-6 pb-14 flex flex-col gap-5">
        <AppHeader user={user} active="/tpa" title="المراجعة والترحيل للمطبعة" subtitle="شركة TPA · كل جهات العمل" />
        <ReviewBoard mode="tpa" user={user} />
      </div>
    </main>
  );
}
