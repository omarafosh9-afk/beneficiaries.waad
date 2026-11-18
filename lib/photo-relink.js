// نقل صور رفع ZIP إلى أصحاب أرقامها (نفس منطق scripts/photo-relink.mjs، لزر الإصلاح في مركز المشاكل).
// لكل صورة يُقرأ رقمها من اسم الملف الأصلي في سجل التغييرات؛ كل رفعة تُنسب للدفعة التي تطابق أرقامها أكثر.
// من فقد صورة ولم تصله أخرى تعود صورته السابقة إن وُجدت. لا تُحذف أي صورة من التخزين.
import { getDb, nowIso } from './db.js';

export async function relinkPhotos(entityId, actor) {
  const db = await getDb();
  const rows = await db.all('SELECT * FROM beneficiaries WHERE entity_id = ? AND deleted = 0', [entityId]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const evs = await db.all(
    `SELECT e.* FROM beneficiary_events e JOIN beneficiaries b ON b.id = e.beneficiary_id
     WHERE b.entity_id = ? AND b.deleted = 0 AND e.action = 'photo' AND e.reason LIKE 'ملف مضغوط:%' ORDER BY e.id`, [entityId]
  );
  const last = new Map();
  for (const e of evs) last.set(e.beneficiary_id, e);
  const photos = [];
  for (const [id, e] of last) {
    const b = byId.get(id);
    if (!b || b.photo_file !== e.new_value) continue;
    const file = e.reason.replace(/^ملف مضغوط:\s*/, '').replace(/\s*\(نُقلت من .*\)$/, '');
    const m = /\d+/.exec(file.replace(/\.[^.]+$/, ''));
    photos.push({ holder: b, file, n: m ? Number(m[0]) : null, at: e.at, prev: e.old_value || null });
  }
  const groups = new Map();
  for (const p of photos) (groups.get(p.at) || groups.set(p.at, []).get(p.at)).push(p);
  const batches = [...new Set(rows.map((r) => r.intake_batch).filter(Boolean))];
  const moves = [];
  const detach = [];
  for (const list of groups.values()) {
    const score = (b) => list.filter((p) => rows.some((r) => r.intake_batch === b && r.list_serial === p.n)).length;
    const batch = [...batches].sort((a, b) => score(b) - score(a))[0];
    for (const p of list) {
      const target = rows.find((r) => r.intake_batch === batch && r.list_serial === p.n);
      if (!target) {
        if (p.n !== null && !(p.holder.intake_batch === batch && p.holder.list_serial === p.n)) detach.push(p);
        continue;
      }
      if (target.id !== p.holder.id) moves.push({ from: p.holder, to: target, photo: p.holder.photo_file, file: p.file, prev: p.prev });
    }
  }
  const leaving = new Set([...moves.map((m) => m.from.id), ...detach.map((p) => p.holder.id)]);
  const ok = moves.filter((m) => !(m.to.photo_file && !leaving.has(m.to.id)));
  const receivers = new Set(ok.map((m) => m.to.id));
  const losers = [
    ...ok.filter((m) => !receivers.has(m.from.id)),
    ...detach.filter((p) => !receivers.has(p.holder.id)).map((p) => ({ from: p.holder, photo: p.holder.photo_file, file: p.file, prev: p.prev, to: null })),
  ];
  const at = nowIso();
  const ev = `INSERT INTO beneficiary_events (beneficiary_id, action, field, old_value, new_value, reason, actor, at) VALUES (?, 'photo', 'photo_file', ?, ?, ?, ?, ?)`;
  const set = 'UPDATE beneficiaries SET photo_file = ?, version = version + 1, updated_at = ? WHERE id = ?';
  const stmts = [];
  for (const m of losers) {
    stmts.push([set, [m.prev, at, m.from.id]]);
    stmts.push([ev, [m.from.id, m.photo, m.prev || '', `الصورة ${m.file} ليست له؛ ${m.to ? `نُقلت إلى ${m.to.name}` : 'صاحبها ليس في المنظومة'}`, actor, at]]);
  }
  for (const m of ok) {
    stmts.push([set, [m.photo, at, m.to.id]]);
    stmts.push([ev, [m.to.id, m.to.photo_file || '', m.photo, `ملف مضغوط: ${m.file} (نُقلت من ${m.from.name})`, actor, at]]);
  }
  if (stmts.length) await db.batch(stmts);
  return { fixed: ok.length, detached: detach.length, skipped: moves.length - ok.length };
}
