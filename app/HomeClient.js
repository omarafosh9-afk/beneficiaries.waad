'use client';

import { useState, useCallback } from 'react';
import SearchClient from './SearchClient';
import PersonDetail from './PersonDetail';
import AddPersonModal from './AddPersonModal';
import ImportModal from './ImportModal';

export default function HomeClient() {
  const [selected, setSelected] = useState(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // useCallback هنا ضروري: onSaved يدخل في dependency array لـ useEffect داخل
  // PersonDetail، فلو تغيّر مرجعه في كل رسم كانت تنشأ حلقة تحديث لا نهائية.
  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <>
      <div className="flex justify-end gap-2 mb-3">
        <button
          type="button"
          onClick={() => setImporting(true)}
          className="text-sm bg-white border border-gray-300 text-gray-800 rounded-lg px-4 py-2 font-medium hover:bg-gray-50"
        >
          استيراد من إكسل
        </button>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-sm bg-green-600 text-white rounded-lg px-4 py-2 font-medium"
        >
          + إضافة شخص جديد
        </button>
      </div>

      <SearchClient onPick={setSelected} refreshKey={refreshKey} />

      <PersonDetail
        person={selected}
        onClose={() => setSelected(null)}
        onSaved={refresh}
      />

      {adding && (
        <AddPersonModal
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            refresh();
          }}
        />
      )}

      {importing && (
        <ImportModal
          onClose={() => setImporting(false)}
          onSaved={refresh}
        />
      )}
    </>
  );
}
