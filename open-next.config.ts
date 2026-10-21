import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// كل الصفحات ديناميكية (بيانات خلف تسجيل دخول)، فلا حاجة لذاكرة تخزين مؤقت إضافية.
export default defineCloudflareConfig();
