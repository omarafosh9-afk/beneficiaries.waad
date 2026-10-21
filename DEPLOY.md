# تشغيل المنظومة على خادم بـ Docker

المنظومة حاوية مستقلة تعمل على منفذ داخلي (3100)، فيمكن وضعها بجانب أي نظام آخر
على نفس الخادم برابط مختلف، مثل `beneficiaries.example.com`.

## أول مرة

1. انسخ المشروع إلى الخادم، وضع بجانبه:
   - `data/people.json` (لنقل البيانات الحالية مرة واحدة)
   - مجلد الصور `storage/` وفيه `Cement` و`Jalyana` و`Jamarek`
2. أنشئ ملف `.env` فيه سر الجلسات:
   ```
   SESSION_SECRET=<نص عشوائي طويل، مثلا ناتج: openssl rand -hex 32>
   ```
3. ابنِ وشغّل:
   ```
   docker compose build
   docker compose run --rm beneficiaries node scripts/db-import.mjs
   docker compose run --rm beneficiaries node scripts/user-add.mjs --username tpa --name "إدارة TPA" --role tpa --password "..."
   docker compose run --rm beneficiaries node scripts/user-add.mjs --username jalyana --name "مراجع جليانة" --role entity --entity Jalyana --password "..."
   docker compose up -d
   ```
   الجهات: `Cement` و`Jalyana` و`Jamarek`. كلمة المرور 8 أحرف على الأقل.

## الرابط الخارجي (reverse proxy)

وجّه النطاق الفرعي إلى `127.0.0.1:3100` مع HTTPS. مثال Nginx:

```nginx
server {
  server_name beneficiaries.example.com;
  client_max_body_size 12m;            # رفع الصور حتى 10 ميغابايت
  location / {
    proxy_pass http://127.0.0.1:3100;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

استخدم نطاقًا فرعيًا وليس مسارًا داخل نطاق نظام آخر (مثل `example.com/beneficiaries`)،
لأن المسار الفرعي يتطلب إعادة بناء المنظومة بإعداد خاص.

## النسخ الاحتياطي

```
docker compose run --rm beneficiaries node scripts/db-backup.mjs
```
تُحفظ النسخة في `data/backups/`. انسخ مجلدي `data/` و`storage/` دوريًا خارج الخادم.

---

# التشغيل على Cloudflare Workers (الخطة المجانية)

يعمل نفس الكود على Cloudflare: البيانات في D1 (`beneficiaries-db`) والصور في KV (`PHOTOS`).
الإعداد في `wrangler.jsonc`. الرابط الحالي: https://beneficiaries.ufuq-alamal.workers.dev

## قيود الخطة المجانية
- 10 ملّي ثانية معالجة لكل طلب: الصفحات تعمل، لكن قد يظهر أحيانا خطأ 1102 مع العمليات الثقيلة.
- الصور تُحفظ كما تُرفع بلا تصغير، وحدّها 1 ميغابايت.
- الشاشة القديمة (البحث والصور والاستيراد) مخصصة للتشغيل المحلي/Docker.

## تحديث النسخة المنشورة
```
npm run cf:deploy
```

## بيانات تجربة (تمسح بيانات D1 الحالية)
```
node scripts/cf-seed.mjs --entity Jalyana --photos 10     # يطبع كلمات مرور المستخدمين
npx wrangler d1 execute beneficiaries-db --remote --file .wrangler/seed/seed.sql
npx wrangler kv bulk put .wrangler/seed/photos.json --binding PHOTOS --remote
```

## أول مرة على حساب جديد
```
npx wrangler d1 create beneficiaries-db            # ضع database_id في wrangler.jsonc
npx wrangler kv namespace create beneficiaries-photos   # ضع id في wrangler.jsonc
npx wrangler secret put SESSION_SECRET             # نص عشوائي طويل
```
