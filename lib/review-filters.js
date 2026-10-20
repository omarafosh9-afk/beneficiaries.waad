// يحوّل معاملات الرابط إلى فلاتر، مع حصر مستخدم الجهة في جهته.
import { scopeEntity } from './auth.js';

export function filtersFrom(searchParams, user) {
  return {
    entityId: scopeEntity(user, searchParams.get('entity')),
    tab: searchParams.get('tab') || 'all',
    q: searchParams.get('q') || '',
    relation: searchParams.get('relation') || '',
    completeness: searchParams.get('completeness') || '',
    intake: searchParams.get('intake') || '',
    grouped: searchParams.get('grouped') !== '0',
    page: searchParams.get('page') || 1,
    sort: searchParams.get('sort') || 'job',
    dir: searchParams.get('dir') === 'desc' ? 'desc' : 'asc',
  };
}
