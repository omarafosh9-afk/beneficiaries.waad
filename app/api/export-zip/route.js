import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { buildZip } from '../../../lib/zip';

function safeName(s) {
  return String(s || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function POST(request) {
  const { ids } = await request.json();
  if (!Array.isArray(ids) || !ids.length) {
    return NextResponse.json({ error: 'لا توجد عناصر محددة' }, { status: 400 });
  }

  const peoplePath = path.join(process.cwd(), 'data', 'people.json');
  const people = JSON.parse(fs.readFileSync(peoplePath, 'utf-8'));
  const byId = new Map(people.map((p) => [p.id, p]));

  const files = [];
  const usedNames = new Set();
  for (const id of ids) {
    const p = byId.get(id);
    if (!p) continue;
    const card = p.card1 || p.card2 || '';
    const photoPath = path.join(process.cwd(), 'public', 'storage', p.company, `${p.photoSlug}.webp`);
    if (!fs.existsSync(photoPath)) continue;
    let name = `${safeName(p.name)}_${safeName(card)}.webp`;
    let n = 2;
    while (usedNames.has(name)) { name = `${safeName(p.name)}_${safeName(card)}_${n}.webp`; n++; }
    usedNames.add(name);
    files.push({ name, data: fs.readFileSync(photoPath) });
  }

  if (!files.length) {
    return NextResponse.json({ error: 'لا توجد صور متاحة للعناصر المحددة' }, { status: 404 });
  }

  const zipBuf = buildZip(files);
  return new NextResponse(zipBuf, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="photos_export.zip"`,
    },
  });
}
