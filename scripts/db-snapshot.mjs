// نسخة متسقة من القاعدة إلى ملف محدد (للرفع إلى السيرفر): node scripts/db-snapshot.mjs <الملف>
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../lib/db-node.js';

const out = path.resolve(process.argv[2] || 'app-snapshot.db');
fs.rmSync(out, { force: true });
const db = openDb();
db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
db.close();
console.log('تم: ' + out);
