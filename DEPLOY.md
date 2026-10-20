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
