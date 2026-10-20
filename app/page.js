import { redirect } from 'next/navigation';
import { currentUser } from '../lib/auth.js';
import AppHeader from './components/AppHeader';
import HomeClient from './HomeClient';

export default async function Page() {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.role !== 'tpa') redirect('/review');
  return (
    <main className="max-w-6xl mx-auto w-full p-4 md:p-8 flex flex-col gap-6">
      <AppHeader user={user} active="/" title="البحث والصور"
        subtitle="ابحث عن مستفيد لعرض بياناته وصورته، أو لاستيراد صورة جديدة له." />
      <HomeClient />
    </main>
  );
}
