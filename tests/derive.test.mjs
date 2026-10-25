import test from 'node:test';
import assert from 'node:assert/strict';
import { familyKeyFromCard, deriveRows, normalizeAr, parseDob } from '../lib/derive.js';

test('familyKeyFromCard', () => {
  assert.equal(familyKeyFromCard('JFZ202533410W1'), '33410');
  assert.equal(familyKeyFromCard('JMR202527315'), '27315');
  assert.equal(familyKeyFromCard('LCC202500412W'), '412');
  assert.equal(familyKeyFromCard('JFZ2025VIP2W1'), 'VIP2');
  assert.equal(familyKeyFromCard('XYZ'), null);
  assert.equal(familyKeyFromCard(''), null);
});

test('deriveRows: job number, employee name, family key', () => {
  const rows = deriveRows([
    { id: 1, company: 'Jalyana', name: 'سالم علي', relation: 'موظف أساسي', card1: 'JFZ202533410' },
    { id: 2, company: 'Jalyana', name: 'فاطمة سعد', relation: 'زوجة', card1: 'JFZ202533410W1', primaryName: '' },
    { id: 3, company: 'Cement', name: 'عمر ميلاد', relation: 'موظف أساسي', job: '1184', card1: 'LCC202500412' },
    { id: 4, company: 'Cement', name: 'زينب علي', relation: 'زوجة', card1: 'LCC202500412W' },
    { id: 5, company: 'Jamarek', name: 'بلا بطاقة', relation: 'ابن', card1: '', batch: 1, deleted: true },
  ]);
  assert.deepEqual(rows.map((r) => r.family_key), ['33410', '33410', '412', '412', 'id:5']);
  assert.deepEqual(rows.map((r) => r.job_no), ['33410', '33410', '1184', '1184', null]);
  assert.equal(rows[1].employee_name, 'سالم علي');
  assert.equal(rows[3].employee_name, 'عمر ميلاد');
  assert.equal(rows[4].deleted, 1);
  assert.equal(rows[4].intake_batch, 1);
  assert.ok(rows[1].search_key.includes('jfz202533410w1'));
});

test('normalizeAr', () => {
  assert.equal(normalizeAr('  أحمد  فاطمة مصطفى '), 'احمد فاطمه مصطفي');
});

test('parseDob', () => {
  assert.equal(parseDob('2014/11/05'), '2014-11-05');
  assert.equal(parseDob('1952'), '1952');
  assert.equal(parseDob(''), '');
  assert.equal(parseDob('2014/02/30'), null);
  assert.equal(parseDob('abc'), null);
  assert.equal(parseDob('1800'), null);
});

test('parseDob accepts dd/mm/yyyy', () => {
  assert.equal(parseDob('05/11/2014'), '2014-11-05');
  assert.equal(parseDob('5/1/2014'), '2014-01-05');
  assert.equal(parseDob('31/02/2014'), null);
});
