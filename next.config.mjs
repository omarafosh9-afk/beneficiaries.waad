/** @type {import('next').NextConfig} */
const nextConfig = {
  // مخرجات مستقلة لصورة Docker صغيرة (node server.js بلا node_modules كاملة).
  output: 'standalone',
  // البيانات والصور الشخصية خارج المخرجات دائما (تأتي من volumes في Docker).
  outputFileTracingExcludes: { '*': ['./public/storage/**', './data/**', './docs/**', './tests/**'] },
  experimental: {
    // رفع صورة المستفيد حتى 10 ميغابايت عبر Server Action.
    serverActions: { bodySizeLimit: '11mb' },
  },
};

export default nextConfig;
