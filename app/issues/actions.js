'use server';

import { requireUser, actorName } from '../../lib/auth.js';
import { scanIssues, fixIssue } from '../../lib/issues.js';

// مركز المشاكل لإدارة TPA فقط.
async function guard(fn) {
  try {
    const me = await requireUser(['tpa']);
    return { ok: true, ...(await fn(me)), issues: await scanIssues() };
  } catch (e) {
    return { ok: false, error: e.message || 'حدث خطأ غير متوقع.' };
  }
}

export async function rescanAction() {
  return guard(async () => ({}));
}

export async function fixIssueAction(entityId, key) {
  return guard(async (me) => ({ result: await fixIssue(entityId, key, actorName(me)) }));
}
