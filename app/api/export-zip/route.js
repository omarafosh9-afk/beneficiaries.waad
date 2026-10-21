import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { loadLegacyPeople, saveLegacyPeople } from '../../../lib/beneficiaries.js';
import { STORAGE_DIR } from '../../../lib/photos.js';
import { requireUser } from '../../../lib/auth.js';
import { buildZip } from '../../../lib/zip';

function safeName(s) {
  return String(s || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
}

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
  const byId = new Map(people.map((p) => [p.id, p]));

  const files = [];
  const usedNames = new Set();
  for (const id of ids) {
    const p = byId.get(id);
    if (!p) continue;
    const card = p.card1 || p.card2 || '';
    const photoPath = path.join(STORAGE_DIR, p.company, `${p.photoSlug}.webp`);
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
