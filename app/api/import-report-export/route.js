import * as XLSX from 'xlsx';
import { loadLegacyPeople, saveLegacyPeople } from '../../../lib/beneficiaries.js';
import { STORAGE_DIR } from '../../../lib/db.js';
import { requireUser } from '../../../lib/auth.js';
import { NextResponse } from 'next/server';

// يحوّل تقرير الاستيراد (المرسل من العميل بعد تنفيذ importExcel) إلى ملف
// إكسل قابل للتنزيل، بنفس الأعمدة المعروضة في الجدول داخل الأداة.
export async function POST(request) {
  try {
    await requireUser(['tpa']);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 403 });
  }
  const { report } = await request.json();
  if (!Array.isArray(report) || !report.length) {
    return NextResponse.json({ error: 'لا يوجد تقرير' }, { status: 400 });
  }

  const rows = report.map((r) => ({
    'الصف': r.row,
    'الاسم': r.name,
    'رقم البطاقة': r.card1,
    'تاريخ الميلاد': r.dob,
    'الحالة': r.status,
    'ملاحظة': r.reason,
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'تقرير الاستيراد');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="import_report.xlsx"',
    },
  });
}
