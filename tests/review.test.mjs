import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-test-'));
process.env.DATA_DIR = dir;
process.env.STORAGE_DIR = path.join(dir, 'storage');
for (const [code, ids] of [['Jalyana', [1, 2, 4]], ['Jamarek', [5]]]) {
  fs.mkdirSync(path.join(dir, 'storage', code), { recursive: true });
  for (const i of ids) fs.writeFileSync(path.join(dir, 'storage', code, `p${i}.webp`), 'x');
}

const { getDb, tx, nowIso } = await import('../lib/db.js');
const { deriveRows } = await import('../lib/derive.js');
const B = await import('../lib/beneficiaries.js');

const people = [
  { id: 1, company: 'Jalyana', name: 'سالم عبدالله الورفلي', relation: 'موظف أساسي', dob: '1979-03-14', card1: 'JFZ202533410' },
  { id: 2, company: 'Jalyana', name: 'فاطمة علي البرعصي', relation: 'زوجة', dob: '1985-08-22', card1: 'JFZ202533410W1' },
  { id: 3, company: 'Jalyana', name: 'مريم سالم الورفلي', relation: 'ابنة', dob: '', card1: 'JFZ202533410D1' },
  { id: 4, company: 'Jalyana', name: 'خالد مفتاح العبيدي', relation: 'موظف أساسي', dob: '1976-07-30', card1: 'JFZ202533587' },
  { id: 5, company: 'Jamarek', name: 'يوسف حسين المسماري', relation: 'موظف أساسي', dob: '1983-05-02', card1: 'JMR202527315' },
];
const db = getDb();
tx(db, () => {
  const at = nowIso();
  for (const r of deriveRows(people)) {
    db.prepare(`INSERT INTO beneficiaries (id, entity_id, family_key, job_no, employee_name, name, relation, dob, card1, photo_file, deleted, search_key, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(r.id, r.entity_id, r.family_key, r.job_no, r.employee_name, r.name, r.relation, r.dob, r.card1,
      r.id === 3 ? null : `p${r.id}.webp`, 0, r.search_key, at);
  }
});

test('list grouped by family with counts', () => {
  const res = B.listBeneficiaries({ entityId: 2, grouped: true });
  assert.equal(res.total, 2);
  assert.equal(res.families[0].jobNo, '33410');
  assert.equal(res.families[0].employeeName, 'سالم عبدالله الورفلي');
  assert.deepEqual(res.families[0].members.map((m) => m.id), [1, 2, 3]);
  assert.equal(res.counts.pending, 4);
  assert.deepEqual(res.progress, { done: 0, total: 4 });
});

test('search uses Arabic normalization', () => {
  const res = B.listBeneficiaries({ entityId: 2, q: 'فاطمه', grouped: false });
  assert.deepEqual(res.rows.map((r) => r.id), [2]);
});

test('completeness filter', () => {
  const res = B.listBeneficiaries({ entityId: 2, completeness: 'missing', grouped: false });
  assert.deepEqual(res.rows.map((r) => r.id), [3]);
});

test('approve only pending, scoped to entity', () => {
  const r = B.approve({ ids: [1, 5] }, 'test', 2);
  assert.equal(r.approved, 1);
  assert.equal(B.getBeneficiary(5).review_status, 'pending');
  assert.equal(B.getBeneficiary(1).review_status, 'correct');
});

test('edit requires reason and real change, records old value', () => {
  const b = B.getBeneficiary(2);
  assert.throws(() => B.editBeneficiary({ id: 2, version: b.version, name: b.name, relation: b.relation, dob: b.dob, reason: 'x' }, 't'), /لم يتغيّر/);
  assert.throws(() => B.editBeneficiary({ id: 2, version: b.version, name: b.name, relation: b.relation, dob: '1986-08-22', reason: '' }, 't'), /سبب/);
  const v = B.editBeneficiary({ id: 2, version: b.version, name: b.name, relation: b.relation, dob: '1986-08-22', reason: 'حسب الرقم الوطني' }, 't');
  assert.equal(v.status, 'modified');
  const listed = B.listBeneficiaries({ entityId: 2, tab: 'modified', grouped: false }).rows[0];
  assert.equal(listed.prev.dob, '1985-08-22');
  assert.throws(() => B.editBeneficiary({ id: 2, version: b.version, name: 'س', relation: b.relation, dob: '1986-08-22', reason: 'r' }, 't'), /حدّث الصفحة/);
});

test('needs_edit cannot be approved; forward only ready, per entity batch, then locked', () => {
  B.returnForEdit(4, 'الصورة غير واضحة', 'tpa');
  assert.equal(B.approve({ ids: [4] }, 't').approved, 0);
  const ar = B.approve({ ids: [3, 5] }, 't');
  assert.equal(ar.approved, 1);
  assert.deepEqual(ar.incomplete, [{ id: 3, name: 'مريم سالم الورفلي', missing: ['الصورة', 'المواليد'] }]);
  assert.equal(B.previewApproval({ ids: [3] }).incompleteCount, 1);
  const pv = B.previewForward({ ids: [1, 2, 3, 5] });
  assert.equal(pv.ready, 3); // 3 has no photo/dob
  const batches = B.forward({ ids: [1, 2, 3, 5] }, 'tpa');
  assert.equal(batches.length, 2);
  assert.equal(B.getBeneficiary(3).review_status, 'pending'); // ناقص: لا يُعتمد
  assert.equal(B.getBeneficiary(1).review_status, 'forwarded');
  const b1 = B.getBeneficiary(1);
  assert.throws(() => B.editBeneficiary({ id: 1, version: b1.version, name: 'x y', relation: b1.relation, dob: b1.dob, reason: 'r' }, 't'), /مقفل/);
  assert.equal(B.listBatches().length, 2);
});

test('legacy adapter round-trips without spurious changes', () => {
  const legacy = B.loadLegacyPeople();
  assert.equal(B.saveLegacyPeople(legacy), 0);
  legacy.find((p) => p.id === 5).name = 'يوسف حسين علي المسماري';
  legacy.push({ id: 6, company: 'Cement', name: 'جديد', relation: 'موظف أساسي', card1: 'LCC202500999', photoSlug: 'none' });
  assert.equal(B.saveLegacyPeople(legacy), 2);
  assert.equal(B.getBeneficiary(5).name, 'يوسف حسين علي المسماري');
  assert.equal(B.getBeneficiary(6).family_key, '999');
});

test('user management: create, reset password, deactivate', async () => {
  const U = await import('../lib/users.js');
  const { checkPassword } = await import('../lib/session.js');
  assert.throws(() => U.createUser({ username: 'ab', displayName: 'x', role: 'tpa' }), /اسم المستخدم/);
  assert.throws(() => U.createUser({ username: 'jal1', displayName: 'x', role: 'entity' }), /الجهة/);
  const c = U.createUser({ username: 'jal1', displayName: 'مراجع', role: 'entity', entityId: 2 });
  assert.throws(() => U.createUser({ username: 'jal1', displayName: 'x', role: 'tpa' }), /من قبل/);
  const u = U.listUsers().find((x) => x.username === 'jal1');
  assert.equal(u.entity, 'جليانة');
  const hash = () => getDb().prepare('SELECT password_hash h FROM users WHERE id = ?').get(u.id).h;
  assert.ok(checkPassword(c.password, hash()));
  const r = U.resetPassword(u.id);
  assert.ok(!checkPassword(c.password, hash()) && checkPassword(r.password, hash()));
  assert.throws(() => U.setActive(u.id, false, u.id), /حسابك/);
  U.setActive(u.id, false, 999);
  assert.equal(U.listUsers().find((x) => x.id === u.id).active, 0);
});
