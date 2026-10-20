import LoginForm from './LoginForm';

export const metadata = { title: 'تسجيل الدخول' };

export default async function LoginPage({ searchParams }) {
  const { next } = await searchParams;
  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-[#F4F6F9]">
      <div className="w-full max-w-sm bg-white border border-[#E3E8EF] rounded-2xl p-6 flex flex-col gap-5">
        <div>
          <h1 className="text-xl font-bold">منظومة المستفيدين</h1>
          <p className="text-sm text-[#5B6475] mt-1">سجّل الدخول بحساب جهتك أو حساب الشركة.</p>
        </div>
        <LoginForm next={typeof next === 'string' ? next : ''} />
      </div>
    </main>
  );
}
