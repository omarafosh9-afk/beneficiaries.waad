// قالب Excel لاستيراد قائمة مستفيدين.
import { NextResponse } from 'next/server';
import { requireUser } from '../../../../lib/auth.js';
import { templateBuffer } from '../../../../lib/beneficiary-import.js';

export async function GET() {
  try {
    await requireUser(['tpa']);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 403 });
  }
  return new Response(templateBuffer(), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="template.xlsx"; filename*=UTF-8''${encodeURIComponent('قالب استيراد المستفيدين.xlsx')}`,
    },
  });
}
