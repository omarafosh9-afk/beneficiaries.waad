import HomeClient from './HomeClient';

export default function Page() {
  return (
    <main className="max-w-6xl mx-auto w-full p-4 md:p-8">
      <h1 className="text-2xl font-bold mb-1">أداة المستفيدين</h1>
      <p className="text-gray-500 mb-6">ابحث عن مستفيد لعرض بياناته وصورته، أو لاستيراد صورة جديدة له.</p>
      <HomeClient />
    </main>
  );
}
