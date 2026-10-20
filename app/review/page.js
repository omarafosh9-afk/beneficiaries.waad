import { redirect } from 'next/navigation';
import { currentUser } from '../../lib/auth.js';
import AppHeader from '../components/AppHeader';
import ReviewBoard from './ReviewBoard';

export const metadata = { title: 'مراجعة المستفيدين واعتمادهم' };

export default async function ReviewPage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=/review');
  if (user.role !== 'entity') redirect(user.role === 'tpa' ? '/tpa' : '/login');
  return (
    <main className="min-h-screen bg-[#F4F6F9]">
      <div className="max-w-[1360px] mx-auto px-4 md:px-6 pt-6 pb-14 flex flex-col gap-5">
        <AppHeader user={user} active="/review" title="قائمة المستفيدين"
          subtitle={`مراجعة بيانات المستفيدين واعتمادها${user.entityName ? ` · جهة العمل: ${user.entityName}` : ''}`} />
        <ReviewBoard mode="entity" user={user} />
      </div>
    </main>
  );
}
