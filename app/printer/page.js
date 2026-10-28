import { redirect } from 'next/navigation';
import { currentUser } from '../../lib/auth.js';
import { importTargets } from '../../lib/photo-import.js';
import AppHeader from '../components/AppHeader';
import PhotoImport from './PhotoImport';

export const metadata = { title: 'رفع الصور' };

export default async function PrinterPage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=/printer');
  if (user.role !== 'printer' && user.role !== 'tpa') redirect('/review');
  return (
    <main className="min-h-screen bg-[#F4F6F9]">
      <div className="max-w-[1100px] mx-auto px-4 md:px-6 pt-4 pb-10 flex flex-col gap-3">
        <AppHeader user={user} active="/printer" title="رفع صور المستفيدين"
          subtitle="ملف مضغوط (ZIP) فيه الصور؛ رقم كل صورة في اسمها يُربط بالتسلسل في المنظومة" />
        <PhotoImport targets={await importTargets()} />
      </div>
    </main>
  );
}
