/** @type {import('next').NextConfig} */
// البناء لـ Cloudflare: CF_BUILD=1 (من سكربت cf:build) يستبدل sharp ببديل فارغ.
const cfBuild = process.env.CF_BUILD === '1';

const nextConfig = {
  ...(cfBuild ? { turbopack: { resolveAlias: { sharp: './lib/sharp-stub.js' } } } : {}),
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
