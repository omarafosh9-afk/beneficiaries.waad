import { redirect } from 'next/navigation';
import { currentUser } from '../../lib/auth.js';
import AppHeader from '../components/AppHeader';
import PasswordForm from './PasswordForm';

export const metadata = { title: 'كلمة المرور' };

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=/account');
  return (
    <main className="min-h-screen bg-[#F4F6F9]">
      <div className="max-w-[1100px] mx-auto px-4 md:px-6 pt-4 pb-10 flex flex-col gap-3">
        <AppHeader user={user} active="/account" title="تغيير كلمة المرور" subtitle={`الحساب: ${user.username}`} />
        <section className="max-w-[420px] w-full bg-white border border-[#E3E8EF] rounded-xl p-5">
          <PasswordForm />
        </section>
      </div>
    </main>
  );
}
