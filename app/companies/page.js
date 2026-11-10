import { redirect } from 'next/navigation';
import { currentUser } from '../../lib/auth.js';
import { listEntities } from '../../lib/entities.js';
import AppHeader from '../components/AppHeader';
import CompaniesClient from './CompaniesClient';

export const metadata = { title: 'الجهات والاستيراد' };

export default async function CompaniesPage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=/companies');
  if (user.role !== 'tpa') redirect('/review');
  return (
    <main className="min-h-screen bg-[#F4F6F9]">
      <div className="max-w-[1100px] mx-auto px-4 md:px-6 pt-4 pb-10 flex flex-col gap-3">
        <AppHeader user={user} active="/companies" title="الجهات والاستيراد"
          subtitle="إضافة جهة عمل جديدة، واستيراد قوائم المستفيدين من ملف Excel بالقالب" />
        <CompaniesClient initialEntities={await listEntities()} />
      </div>
    </main>
  );
}
