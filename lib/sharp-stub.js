// بديل sharp عند البناء لـ Cloudflare Workers (لا تدعم المكتبات الأصلية). لا يُستدعى هناك فعليًا.
export default function sharp() {
  throw new Error('sharp غير متاحة على Cloudflare Workers');
}
