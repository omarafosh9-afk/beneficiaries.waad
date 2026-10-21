import fs from 'fs';
import path from 'path';
import { loadLegacyPeople, saveLegacyPeople } from '../../../lib/beneficiaries.js';
import { STORAGE_DIR } from '../../../lib/photos.js';
import { requireUser } from '../../../lib/auth.js';
import { NextResponse } from 'next/server';

// حذف ناعم جماعي: يعلّم كل الأشخاص المحددين كمحذوفين بدل مسحهم، بنفس منطق
// الحذف الفردي في actions.js (deletePerson) لكن دفعة واحدة.
export async function POST(request) {
  try {
    await requireUser(['tpa']);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 403 });
  }
  const { ids } = await request.json();
  if (!Array.isArray(ids) || !ids.length) {
    return NextResponse.json({ error: 'لا توجد عناصر محددة' }, { status: 400 });
  }

  const people = await loadLegacyPeople();
  const idSet = new Set(ids);
  const now = new Date().toISOString();

  let count = 0;
  for (const p of people) {
    if (idSet.has(p.id) && !p.deleted) {
      p.deleted = true;
      p.deletedAt = now;
      count++;
    }
  }

  await saveLegacyPeople(people);
  return NextResponse.json({ ok: true, count });
}
