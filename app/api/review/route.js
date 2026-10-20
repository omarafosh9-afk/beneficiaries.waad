import { NextResponse } from 'next/server';
import { requireUser } from '../../../lib/auth.js';
import { filtersFrom } from '../../../lib/review-filters.js';
import { listBeneficiaries, intakeBatches, listBatches } from '../../../lib/beneficiaries.js';

export async function GET(request) {
  let user;
  try {
    user = await requireUser(['tpa', 'entity']);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 403 });
  }
  const { searchParams } = new URL(request.url);
  const f = filtersFrom(searchParams, user);
  const data = listBeneficiaries(f);
  data.intakeBatches = f.entityId ? intakeBatches(f.entityId) : [];
  if (user.role === 'tpa') data.printBatches = listBatches();
  return NextResponse.json(data);
}
