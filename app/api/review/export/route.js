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
    user = await requireUser(['tpa', 'entity', 'printer']);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 403 });
  }
  const { searchParams } = new URL(request.url);
  const rows = (await exportRows(filtersFrom(searchParams, user))).map((r) => ({
    ...(user.role !== 'entity' ? { 'الجهة': r.entity } : {}),
    'التسلسل العام': r.seq ?? '',
    'الدفعة': r.listBatch || '',
    'التسلسل في الدفعة': r.serial ?? '',
    'الرقم الوظيفي': r.jobNo || '',
    'اسم الموظف': r.employeeName || '',
    'اسم المستفيد': r.name,
    'صلة القرابة': r.relation,
    'المواليد': /^\d{4}-\d{2}-\d{2}$/.test(r.dob) ? `${r.dob.slice(8, 10)}/${r.dob.slice(5, 7)}/${r.dob.slice(0, 4)}` : r.dob,
    'رقم البطاقة': r.card,
    'الحالة': STATUS_AR[r.status] || r.status,
    'حالة المستفيد': r.benStatus,
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
