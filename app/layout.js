import "./globals.css";

export const metadata = {
  title: "أداة المستفيدين",
  description: "عرض بيانات المستفيدين مع صورهم",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-gray-50 text-gray-900">{children}</body>
    </html>
  );
}
