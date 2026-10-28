'use server';

import { requireUser, actorName } from '../../lib/auth.js';
import { startImport, jobStatus } from '../../lib/photo-import.js';

async function guard(fn) {
  try {
    const user = await requireUser(['printer', 'tpa']);
    return { ok: true, ...(await fn(user)) };
  } catch (e) {
    return { ok: false, error: e.message || 'حدث خطأ غير متوقع.' };
  }
}

export async function startImportAction(input) {
  return guard(async (u) => ({ jobId: await startImport(input, actorName(u)) }));
}

export async function importStatusAction(jobId) {
  return guard(async () => ({ job: jobStatus(jobId) }));
}
