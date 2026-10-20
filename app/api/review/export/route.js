// تصدير ما يطابق الفلتر الحالي إلى Excel بالترتيب المطلوب للأعمدة.
import * as XLSX from 'xlsx';
import { NextResponse } from 'next/server';
import { requireUser } from '../../../../lib/auth.js';
import { exportRows } from '../../../../lib/beneficiaries.js';
import { filtersFrom } from '../../../../lib/review-filters.js';

const STATUS_AR = {
  pending: 'بانتظار التحقق', needs_edit: 'يحتاج تعديل', correct: 'صحيح', modified: 'معدل',
  forwarded: 'مرحّل', printed: 'مطبوع', delivered: 'مُسلَّم',
};

export async function GET(request) {
  let user;
  try {
    user = await requireUser(['tpa', 'entity']);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 403 });
  }
  const { searchParams } = new URL(request.url);
  const rows = exportRows(filtersFrom(searchParams, user)).map((r) => ({
    ...(user.role === 'tpa' ? { 'الجهة': r.entity } : {}),
    'الرقم الوظيفي': r.jobNo || '',
    'اسم الموظف': r.employeeName || '',
    'اسم المستفيد': r.name,
    'صلة القرابة': r.relation,
    'المواليد': r.dob,
    'رقم البطاقة': r.card,
    'الحالة': STATUS_AR[r.status] || r.status,
    'سبب التعديل': r.reason,
    'ملاحظة TPA': r.note,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!views'] = [{ RTL: true }];
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, 'المستفيدون');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="beneficiaries.xlsx"`,
    },
  });
}
