// نسخة احتياطية متسقة من القاعدة: data/backups/app-YYYYMMDD-HHmm.db
import fs from 'node:fs';
import path from 'node:path';
import { openDb, DATA_DIR } from '../lib/db.js';

const d = new Date();
const p = (n) => String(n).padStart(2, '0');
const name = `app-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.db`;
const dir = path.join(DATA_DIR, 'backups');
fs.mkdirSync(dir, { recursive: true });
const target = path.join(dir, name);
const db = openDb();
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();
console.log('تم حفظ النسخة: ' + target);
