import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

// حذف ناعم جماعي: يعلّم كل الأشخاص المحددين كمحذوفين بدل مسحهم، بنفس منطق
// الحذف الفردي في actions.js (deletePerson) لكن دفعة واحدة.
export async function POST(request) {
  const { ids } = await request.json();
  if (!Array.isArray(ids) || !ids.length) {
    return NextResponse.json({ error: 'لا توجد عناصر محددة' }, { status: 400 });
  }

  const dataPath = path.join(process.cwd(), 'data', 'people.json');
  const people = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
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

  fs.writeFileSync(dataPath, JSON.stringify(people, null, 0), 'utf-8');
  return NextResponse.json({ ok: true, count });
}
