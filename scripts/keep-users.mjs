// يعيد المستخدمين من قاعدة قديمة بعد استبدال القاعدة (حتى لا تضيع حسابات السيرفر وكلمات مرورها):
// node scripts/keep-users.mjs <القاعدة القديمة>
import fs from 'node:fs';
import { openDb, tx } from '../lib/db-node.js';

const from = process.argv[2];
if (!from || !fs.existsSync(from)) {
  console.log('لا توجد قاعدة قديمة؛ بقي مستخدمو القاعدة الجديدة.');
  process.exit(0);
}
const db = openDb();
db.exec(`ATTACH DATABASE '${from.replace(/'/g, "''")}' AS old`);
const n = tx(db, () => {
  db.exec('DELETE FROM users');
  return db.prepare('INSERT INTO users (id, username, display_name, role, entity_id, password_hash, active, created_at) SELECT id, username, display_name, role, entity_id, password_hash, active, created_at FROM old.users').run().changes;
});
db.exec('DETACH DATABASE old');
console.log(`أُعيد ${n} مستخدم من القاعدة السابقة.`);
