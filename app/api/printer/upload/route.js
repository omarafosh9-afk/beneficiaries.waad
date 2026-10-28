// رفع الملف المضغوط على أجزاء (8 ميغابايت لكل طلب) حتى يمر الملف الكبير دون حدود Nginx وذاكرة الخادم.
// POST ?id=<32 hex>&offset=<n> وجسم الطلب = الجزء. يُلحق الجزء فقط إذا طابق offset حجم الملف الحالي.
import fs from 'node:fs';
import { NextResponse } from 'next/server';
import { requireUser } from '../../../../lib/auth.js';
import { uploadPath, UPLOAD_DIR, MAX_UPLOAD } from '../../../../lib/photo-import.js';

export async function POST(request) {
  try {
    await requireUser(['printer', 'tpa']);
    const { searchParams } = new URL(request.url);
    const file = uploadPath(searchParams.get('id'));
    const offset = Number(searchParams.get('offset'));
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const current = fs.existsSync(file) ? fs.statSync(file).size : 0;
    if (offset !== current) return NextResponse.json({ error: 'ترتيب الأجزاء غير صحيح.', size: current }, { status: 409 });
    const chunk = Buffer.from(await request.arrayBuffer());
    if (current + chunk.length > MAX_UPLOAD) return NextResponse.json({ error: 'الملف أكبر من 4 غيغابايت.' }, { status: 413 });
    fs.appendFileSync(file, chunk);
    return NextResponse.json({ size: current + chunk.length });
  } catch (e) {
    return NextResponse.json({ error: e.message || 'تعذّر الرفع.' }, { status: e.status || 400 });
  }
}
