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

const { getDb, nowIso } = await import('../lib/db.js');
const { deriveRows } = await import('../lib/derive.js');
const B = await import('../lib/beneficiaries.js');

const people = [
  { id: 1, company: 'Jalyana', name: 'سالم عبدالله الورفلي', relation: 'موظف أساسي', dob: '1979-03-14', card1: 'JFZ202533410' },
  { id: 2, company: 'Jalyana', name: 'فاطمة علي البرعصي', relation: 'زوجة', dob: '1985-08-22', card1: 'JFZ202533410W1' },
  { id: 3, company: 'Jalyana', name: 'مريم سالم الورفلي', relation: 'ابنة', dob: '', card1: 'JFZ202533410D1' },
  { id: 4, company: 'Jalyana', name: 'خالد مفتاح العبيدي', relation: 'موظف أساسي', dob: '1976-07-30', card1: 'JFZ202533587' },
  { id: 5, company: 'Jamarek', name: 'يوسف حسين المسماري', relation: 'موظف أساسي', dob: '1983-05-02', card1: 'JMR202527315' },
];
const db = await getDb();
const at = nowIso();
await db.batch(
  deriveRows(people).map((r) => [
    `INSERT INTO beneficiaries (id, entity_id, family_key, job_no, employee_name, name, relation, dob, card1, photo_file, deleted, search_key, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [r.id, r.entity_id, r.family_key, r.job_no, r.employee_name, r.name, r.relation, r.dob, r.card1,
      r.id === 3 ? null : `p${r.id}.webp`, 0, r.search_key, at],
  ])
);
const status = async (id) => (await B.getBeneficiary(id)).review_status;

test('list grouped by family with counts', async () => {
  const res = await B.listBeneficiaries({ entityId: 2, grouped: true });
  assert.equal(res.total, 2);
  assert.equal(res.families[0].jobNo, '33410');
  assert.equal(res.families[0].employeeName, 'سالم عبدالله الورفلي');
  assert.deepEqual(res.families[0].members.map((m) => m.id), [1, 2, 3]);
  assert.equal(res.counts.pending, 4);
  assert.deepEqual(res.progress, { done: 0, total: 4 });
});

test('search uses Arabic normalization', async () => {
  const res = await B.listBeneficiaries({ entityId: 2, q: 'فاطمه', grouped: false });
  assert.deepEqual(res.rows.map((r) => r.id), [2]);
});

test('completeness filters', async () => {
  const ids = async (c) => (await B.listBeneficiaries({ entityId: 2, completeness: c, grouped: false })).rows.map((r) => r.id).sort();
  assert.deepEqual(await ids('missing'), [3]);
  assert.deepEqual(await ids('no_photo'), [3]);
  assert.deepEqual(await ids('no_dob'), [3]);
  assert.deepEqual(await ids('no_employee'), []);
});

test('sorting by name, job and direction', async () => {
  const ids = async (o) => (await B.listBeneficiaries({ entityId: 2, grouped: false, ...o })).rows.map((r) => r.id);
  assert.equal((await ids({ sort: 'job' })).at(-1), 4);
  assert.equal((await ids({ sort: 'job', dir: 'desc' }))[0], 4);
  const byName = (await B.listBeneficiaries({ entityId: 2, grouped: false, sort: 'name' })).rows.map((r) => r.name);
  assert.ok(byName[0].startsWith('خالد'), byName.join(','));
  const fam = (await B.listBeneficiaries({ entityId: 2, grouped: true, sort: 'employee', dir: 'desc' })).families.map((f) => f.familyKey);
  assert.deepEqual(fam, ['33410', '33587']);
});

test('approve only pending, scoped to entity', async () => {
  const r = await B.approve({ ids: [1, 5] }, 'test', 2);
  assert.equal(r.approved, 1);
  assert.equal(await status(5), 'pending');
  assert.equal(await status(1), 'correct');
});

test('edit requires reason and real change, records old value', async () => {
  const b = await B.getBeneficiary(2);
  const base = { id: 2, version: b.version, name: b.name, relation: b.relation };
  await assert.rejects(B.editBeneficiary({ ...base, dob: b.dob, reason: 'x' }, 't'), /لم يتغيّر/);
  await assert.rejects(B.editBeneficiary({ ...base, dob: '1986-08-22', reason: '' }, 't'), /سبب/);
  const v = await B.editBeneficiary({ ...base, dob: '1986-08-22', reason: 'حسب الرقم الوطني' }, 't');
  assert.equal(v.status, 'modified');
  const listed = (await B.listBeneficiaries({ entityId: 2, tab: 'modified', grouped: false })).rows[0];
  assert.equal(listed.prev.dob, '1985-08-22');
  await assert.rejects(B.editBeneficiary({ ...base, name: 'س', dob: '1986-08-22', reason: 'r' }, 't'), /حدّث الصفحة/);
});

test('incomplete and needs_edit cannot be approved; forward only ready, per entity batch, then locked', async () => {
  await B.returnForEdit(4, 'الصورة غير واضحة', 'tpa');
  assert.equal((await B.approve({ ids: [4] }, 't')).approved, 0);
  const ar = await B.approve({ ids: [3, 5] }, 't');
  assert.equal(ar.approved, 1);
  assert.deepEqual(ar.incomplete, [{ id: 3, name: 'مريم سالم الورفلي', missing: ['الصورة', 'المواليد'] }]);
  assert.equal((await B.previewApproval({ ids: [3] })).incompleteCount, 1);
  assert.equal(await status(3), 'pending');
  const pv = await B.previewForward({ ids: [1, 2, 3, 5] });
  assert.equal(pv.ready, 3);
  const batches = await B.forward({ ids: [1, 2, 3, 5] }, 'tpa');
  assert.equal(batches.length, 2);
  assert.equal(await status(1), 'forwarded');
  const b1 = await B.getBeneficiary(1);
  await assert.rejects(B.editBeneficiary({ id: 1, version: b1.version, name: 'x y', relation: b1.relation, dob: b1.dob, reason: 'r' }, 't'), /مقفل/);
  assert.equal((await B.listBatches()).length, 2);
});

test('legacy adapter round-trips without spurious changes', async () => {
  const legacy = await B.loadLegacyPeople();
  assert.equal(await B.saveLegacyPeople(legacy), 0);
  legacy.find((p) => p.id === 5).name = 'يوسف حسين علي المسماري';
  legacy.push({ id: 6, company: 'Cement', name: 'جديد', relation: 'موظف أساسي', card1: 'LCC202500999', photoSlug: 'none' });
  assert.equal(await B.saveLegacyPeople(legacy), 2);
  assert.equal((await B.getBeneficiary(5)).name, 'يوسف حسين علي المسماري');
  assert.equal((await B.getBeneficiary(6)).family_key, '999');
});

test('user management: create, set password, edit, deactivate, delete', async () => {
  const U = await import('../lib/users.js');
  const { checkPassword } = await import('../lib/session.js');
  await assert.rejects(U.createUser({ username: 'ab', displayName: 'x', role: 'tpa' }), /اسم المستخدم/);
  await assert.rejects(U.createUser({ username: 'jal1', displayName: 'x', role: 'entity' }), /الجهة/);
  const c = await U.createUser({ username: 'jal1', displayName: 'مراجع', role: 'entity', entityId: 2 });
  await assert.rejects(U.createUser({ username: 'jal1', displayName: 'x', role: 'tpa' }), /من قبل/);
  const u = (await U.listUsers()).find((x) => x.username === 'jal1');
  assert.equal(u.entity, 'جليانة');
  const hash = async () => (await db.get('SELECT password_hash h FROM users WHERE id = ?', [u.id])).h;
  assert.ok(checkPassword(c.password, await hash()));
  const r = await U.setPassword(u.id);
  assert.ok(!checkPassword(c.password, await hash()) && checkPassword(r.password, await hash()));
  assert.match(r.password, /^\d{6}$/);
  await U.setPassword(u.id, 'abcd');
  assert.ok(checkPassword('abcd', await hash()));
  await assert.rejects(U.setPassword(u.id, 'ab'), /كلمة المرور/);
  await U.updateUser(u.id, { username: 'jal2', displayName: 'م', role: 'entity', entityId: 3 }, 999);
  assert.equal((await U.listUsers()).find((x) => x.id === u.id).entity, 'الجمارك');
  await assert.rejects(U.setActive(u.id, false, u.id), /حسابك/);
  await U.setActive(u.id, false, 999);
  assert.equal((await U.listUsers()).find((x) => x.id === u.id).active, 0);
  await assert.rejects(U.deleteUser(u.id, u.id), /حسابك/);
  await U.deleteUser(u.id, 999);
  assert.ok(!(await U.listUsers()).some((x) => x.id === u.id));
});
