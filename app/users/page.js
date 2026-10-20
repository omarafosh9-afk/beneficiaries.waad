import { redirect } from 'next/navigation';
import { currentUser } from '../../lib/auth.js';
import { listUsers } from '../../lib/users.js';
import AppHeader from '../components/AppHeader';
import UsersClient from './UsersClient';

export const metadata = { title: 'إدارة المستخدمين' };

export default async function UsersPage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=/users');
  if (user.role !== 'tpa') redirect('/review');
  return (
    <main className="min-h-screen bg-[#F4F6F9]">
      <div className="max-w-[1100px] mx-auto px-4 md:px-6 pt-6 pb-14 flex flex-col gap-5">
        <AppHeader user={user} active="/users" title="إدارة المستخدمين" subtitle="حسابات جهات العمل وحسابات شركة TPA" />
        <UsersClient initialUsers={listUsers()} meId={user.id} />
      </div>
    </main>
  );
}
