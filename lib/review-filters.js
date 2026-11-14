// يحوّل معاملات الرابط إلى فلاتر، مع حصر مستخدم الجهة في جهته.
import { scopeEntity } from './auth.js';

export function filtersFrom(searchParams, user) {
  return {
    entityId: scopeEntity(user, searchParams.get('entity')),
    // المحذوفات لـ TPA فقط؛ الجهة لا تراها ولا تعرف عددها.
    tab: searchParams.get('tab') === 'deleted' && user.role !== 'tpa' ? 'all' : searchParams.get('tab') || 'all',
    withDeleted: user.role === 'tpa',
    q: searchParams.get('q') || '',
    relation: searchParams.get('relation') || '',
    completeness: searchParams.get('completeness') || '',
    intake: searchParams.get('intake') || '',
    benStatus: searchParams.get('benStatus') || '',
    grouped: searchParams.get('grouped') !== '0',
    page: searchParams.get('page') || 1,
    sort: searchParams.get('sort') || 'serial',
    dir: searchParams.get('dir') === 'desc' ? 'desc' : 'asc',
  };
}
