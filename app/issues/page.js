import { redirect } from 'next/navigation';
import { currentUser } from '../../lib/auth.js';
import { scanIssues } from '../../lib/issues.js';
import AppHeader from '../components/AppHeader';
import IssuesClient from './IssuesClient';

export const metadata = { title: 'مركز المشاكل' };

export default async function IssuesPage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=/issues');
  if (user.role !== 'tpa') redirect('/review');
  return (
    <main className="min-h-screen bg-[#F4F6F9]">
      <div className="max-w-[1100px] mx-auto px-4 md:px-6 pt-4 pb-10 flex flex-col gap-3">
        <AppHeader user={user} active="/issues" title="مركز المشاكل"
          subtitle="فحص تلقائي لبيانات كل الجهات: ما يُكتشف هنا يُعرض في المراجعة لمعالجته، ولبعضه إصلاح تلقائي آمن" />
        <IssuesClient initial={await scanIssues()} />
      </div>
    </main>
  );
}
