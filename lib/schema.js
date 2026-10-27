// مخطط القاعدة - مشترك بين SQLite المحلية وD1 على Cloudflare.
export const SCHEMA_V1 = `
CREATE TABLE entities (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  card_prefix TEXT NOT NULL
);
CREATE TABLE beneficiaries (
  id INTEGER PRIMARY KEY,
  entity_id INTEGER NOT NULL REFERENCES entities(id),
  family_key TEXT NOT NULL,
  job_no TEXT,
  employee_name TEXT,
  name TEXT NOT NULL,
  relation TEXT NOT NULL,
  dob TEXT,
  national_id TEXT,
  card1 TEXT,
  card2 TEXT,
  photo_file TEXT,
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending','correct','modified','needs_edit','forwarded','printed','delivered')),
  review_note TEXT,
  modified_reason TEXT,
  print_batch_id INTEGER REFERENCES print_batches(id),
  intake_batch INTEGER,
  legacy_status TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  search_key TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_benef_entity_status ON beneficiaries(entity_id, deleted, review_status);
CREATE INDEX idx_benef_entity_family ON beneficiaries(entity_id, family_key);
CREATE INDEX idx_benef_card1 ON beneficiaries(card1);
CREATE INDEX idx_benef_card2 ON beneficiaries(card2);
CREATE TABLE beneficiary_events (
  id INTEGER PRIMARY KEY,
  beneficiary_id INTEGER NOT NULL REFERENCES beneficiaries(id),
  action TEXT NOT NULL,
  field TEXT,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  actor TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX idx_events_benef ON beneficiary_events(beneficiary_id, id);
CREATE TABLE print_batches (
  id INTEGER PRIMARY KEY,
  entity_id INTEGER NOT NULL REFERENCES entities(id),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('tpa','entity','printer')),
  entity_id INTEGER REFERENCES entities(id),
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
INSERT INTO entities (id, code, name_ar, card_prefix) VALUES
  (1, 'Cement', 'الاسمنت', 'LCC'),
  (2, 'Jalyana', 'جليانة', 'JFZ'),
  (3, 'Jamarek', 'الجمارك', 'JMR');
`;

// الرقم التسلسلي للمستفيد في قائمة الجهة (عمود «تسلسل»). مفتاح ربط الصور مستقبلًا:
// ملف الصورة يحمل هذا الرقم (مثل 57.jpg) فيُربط بصاحبه داخل نفس الجهة ودفعة القائمة.
// v3: التسلسل العام المتصل عبر الدفعات (الدفعة الثانية تكمل بعد الأولى).
export const SCHEMA_V3 = `
ALTER TABLE beneficiaries ADD COLUMN seq INTEGER;
`;

export const SCHEMA_V2 = `
ALTER TABLE beneficiaries ADD COLUMN list_serial INTEGER;
CREATE UNIQUE INDEX idx_benef_list_serial ON beneficiaries(entity_id, intake_batch, list_serial) WHERE list_serial IS NOT NULL AND deleted = 0;
`;
