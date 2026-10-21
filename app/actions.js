'use server';

import fs from 'fs';
import path from 'path';
import { loadLegacyPeople, saveLegacyPeople } from '../lib/beneficiaries.js';
import { STORAGE_DIR } from '../lib/photos.js';
import { requireUser } from '../lib/auth.js';
import * as XLSX from 'xlsx';

function safeSlug(name, card) {
  const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  return `${safe(name)}_${safe(card)}`;
}

// يحوّل ملف الصورة (إن أُرفق) إلى WebP ويحفظه تحت صورة الشخص المحدَّدة (بشركته
// واسمه ورقم بطاقته الحاليين بعد أي تعديل) - يُستدعى من نفس نموذج/زر الحفظ
// الموحّد لإضافة/تعديل البيانات، فلا يوجد زر منفصل للصورة بعد الآن.
async function savePhotoIfProvided(formData, person) {
  const file = formData.get('file');
  if (!file || typeof file === 'string' || !file.size) return;

  const dir = path.join(STORAGE_DIR, person.company);
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, `${person.photoSlug}.webp`);

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const sharp = (await import('sharp')).default;
  await sharp(buffer)
    .resize(500, 500, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78 })
    .toFile(outPath);
}

// ---------- كشف التكرار (بدقة، مع تنبيه على أدنى اشتباه) ----------

const BIDI = /[‎‏‪-‮⁦-⁩]/g;
function cleanName(v) {
  if (!v) return '';
  return String(v).replace(BIDI, '').replace(/\s+/g, ' ').trim();
}
function matchKey(name) {
  let n = cleanName(name);
  n = n.replace(/[ً-ٰٟـ]/g, '');
  n = n.replace(/[أإآٱ]/g, 'ا').replace(/[ىئ]/g, 'ي').replace(/ؤ/g, 'و').replace(/ة/g, 'ه');
  return n.replace(/\s+/g, ' ').trim();
}
function cardBaseAndSuffix(card) {
  const m = String(card || '').trim().toUpperCase().match(/^([A-Z]+2025)0*(\d+)([A-Z]+\d*)?$/);
  if (!m) return null;
  return { prefix: m[1], base: m[2], suffix: m[3] || '' };
}

// يفحص شخصا مقترحا (اسم/بطاقة/شركة) مقابل كل القاعدة، ويرجع كل تطابق أو اشتباه:
// - بطاقة مطابقة حرفيا (نفس النص تماما) = تكرار مؤكد
// - نفس الجزء الرقمي + نفس اللاحقة لكن بصياغة مختلفة (فروق أصفار) = اشتباه قوي
// - نفس الاسم (بعد التطبيع) بنفس الشركة = اشتباه بالاسم
function findDuplicates(people, { name, card1, card2, company, excludeId }) {
  const matches = [];
  const nameKey = matchKey(name);
  const cards = [card1, card2].filter(Boolean).map((c) => c.trim().toUpperCase());
  const cardInfos = cards.map(cardBaseAndSuffix).filter(Boolean);

  for (const p of people) {
    if (excludeId != null && p.id === excludeId) continue;
    if (p.deleted) continue;
    const pCards = [p.card1, p.card2].filter(Boolean).map((c) => c.trim().toUpperCase());

    // تطابق حرفي لرقم البطاقة
    const exactCard = cards.find((c) => pCards.includes(c));
    if (exactCard) {
      matches.push({ id: p.id, name: p.name, company: p.companyLabel, card: exactCard, reason: 'نفس رقم البطاقة تماما' });
      continue;
    }

    // نفس الجزء الرقمي + نفس اللاحقة (فرق فقط بصفر بادئ أو ما شابه)
    const pCardInfos = pCards.map(cardBaseAndSuffix).filter(Boolean);
    const baseSuffixHit = cardInfos.some((ci) =>
      pCardInfos.some((pci) => ci.prefix === pci.prefix && ci.suffix === pci.suffix && Number(ci.base) === Number(pci.base))
    );
    if (baseSuffixHit) {
      matches.push({ id: p.id, name: p.name, company: p.companyLabel, card: pCards[0], reason: 'نفس رقم البطاقة بصياغة مختلفة (فرق أصفار)' });
      continue;
    }

    // نفس الاسم (بعد التطبيع) بنفس الشركة
    if (company && p.company === company && nameKey && matchKey(p.name) === nameKey) {
      matches.push({ id: p.id, name: p.name, company: p.companyLabel, card: pCards[0] || '—', reason: 'نفس الاسم بنفس الشركة' });
    }
  }
  return matches;
}

const EDITABLE_FIELDS = ['name', 'dob', 'card1', 'relation', 'company'];

// يعدّل بيانات شخص في قاعدة البيانات (عبر محوّل الشاشة القديمة)، ويعيد تسمية
// ملف صورته إن تغيّر الاسم أو رقم البطاقة حتى لا ينقطع الربط بها.
// يفحص التكرار أولا؛ إن وُجد اشتباه يوقف الحفظ ويعرضه، إلا إن أكّد المستخدم صراحة.
export async function updatePerson(prevState, formData) {
  try {
    await requireUser(['tpa']);
    const id = Number(formData.get('id'));
    if (!id) return { ok: false, message: 'معرّف غير صالح.' };

    const people = await loadLegacyPeople();
    const idx = people.findIndex((p) => p.id === id);
    if (idx === -1) return { ok: false, message: 'الشخص غير موجود.' };

    const person = { ...people[idx] };
    const oldSlug = person.photoSlug;
    const oldCompany = person.company;

    for (const field of EDITABLE_FIELDS) {
      if (formData.has(field)) person[field] = String(formData.get(field) || '').trim();
    }
    person.companyLabel = COMPANY_LABELS[person.company] || person.company;

    const confirmed = formData.get('confirmDuplicate') === '1';
    if (!confirmed) {
      const dup = findDuplicates(people, {
        name: person.name, card1: person.card1, card2: person.card2, company: person.company, excludeId: id,
      });
      if (dup.length) {
        return { ok: false, duplicate: true, matches: dup, message: 'اشتباه تكرار — راجع قبل الحفظ.', pendingPerson: person };
      }
    }

    const newCard = person.card1 || person.card2 || '';
    const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
    const newSlug = `${safe(person.name)}_${safe(newCard)}`;
    person.photoSlug = newSlug;

    if (newSlug !== oldSlug || person.company !== oldCompany) {
      const oldDir = path.join(STORAGE_DIR, oldCompany);
      const newDir = path.join(STORAGE_DIR, person.company);
      fs.mkdirSync(newDir, { recursive: true });
      const oldPath = path.join(oldDir, `${oldSlug}.webp`);
      const newPath = path.join(newDir, `${newSlug}.webp`);
      if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
        fs.renameSync(oldPath, newPath);
      }
    }

    await savePhotoIfProvided(formData, person);

    people[idx] = person;
    await saveLegacyPeople(people);

    return { ok: true, message: 'تم حفظ التعديلات.', person };
  } catch (err) {
    return { ok: false, message: 'خطأ: ' + err.message };
  }
}

const COMPANY_LABELS = { Cement: 'الاسمنت', Jalyana: 'جليانة', Jamarek: 'الجمارك' };

// يضيف شخصا جديدا في قاعدة البيانات (عبر محوّل الشاشة القديمة) - لإضافات يدوية
// سريعة داخل الأداة، بمعزل عن ملفات الإكسل المرجعية.
// يفحص التكرار أولا (بطاقة/اسم) ويوقف الحفظ عند أي اشتباه إلا بتأكيد صريح.
export async function addPerson(prevState, formData) {
  try {
    await requireUser(['tpa']);
    const company = String(formData.get('company') || '').trim();
    const name = String(formData.get('name') || '').trim();
    const card1 = String(formData.get('card1') || '').trim();
    const relation = String(formData.get('relation') || '').trim();
    const dob = String(formData.get('dob') || '').trim();
    if (!company || !name || !card1) {
      return { ok: false, message: 'الشركة والاسم ورقم البطاقة الأول حقول إلزامية.' };
    }

    const people = await loadLegacyPeople();

    const confirmed = formData.get('confirmDuplicate') === '1';
    if (!confirmed) {
      const dup = findDuplicates(people, { name, card1, card2: '', company });
      if (dup.length) {
        return {
          ok: false,
          duplicate: true,
          matches: dup,
          message: 'اشتباه تكرار — راجع قبل الإضافة.',
          pendingPerson: { company, name, card1, relation, dob },
        };
      }
    }

    const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
    const photoSlug = `${safe(name)}_${safe(card1)}`;

    const newPerson = {
      id: Math.max(0, ...people.map((p) => p.id)) + 1,
      company,
      companyLabel: COMPANY_LABELS[company] || company,
      name,
      relation,
      primaryName: '',
      job: '',
      national: '',
      dob,
      card1,
      card2: '',
      status: '',
      photoSlug,
    };

    await savePhotoIfProvided(formData, newPerson);

    people.push(newPerson);
    await saveLegacyPeople(people);

    return { ok: true, message: 'تمت إضافة الشخص.', person: newPerson };
  } catch (err) {
    return { ok: false, message: 'خطأ: ' + err.message };
  }
}

// حذف ناعم: لا يمسح السجل ولا الصورة، فقط يعلّمه كمحذوف فيختفي من البحث
// الافتراضي مع بقاء إمكانية استعادته لاحقا.
export async function deletePerson(prevState, formData) {
  try {
    await requireUser(['tpa']);
    const id = Number(formData.get('id'));
    if (!id) return { ok: false, message: 'معرّف غير صالح.' };

    const people = await loadLegacyPeople();
    const idx = people.findIndex((p) => p.id === id);
    if (idx === -1) return { ok: false, message: 'الشخص غير موجود.' };

    people[idx].deleted = true;
    people[idx].deletedAt = new Date().toISOString();
    await saveLegacyPeople(people);

    return { ok: true, message: 'تم حذف البطاقة (يمكن استعادتها لاحقا).', person: people[idx] };
  } catch (err) {
    return { ok: false, message: 'خطأ: ' + err.message };
  }
}

function excelDateToStr(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    // تاريخ إكسل رقمي (أيام منذ 1900) - نفس الطريقة المستخدمة في سكربتات القراءة الأخرى
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    return '';
  }
  return String(v).trim();
}

function findHeaderCol(headers, pattern) {
  for (let i = 0; i < headers.length; i++) {
    if (headers[i] && pattern.test(String(headers[i]))) return i;
  }
  return -1;
}

// استيراد جماعي من إكسل: قالب بسيط بثلاثة أعمدة (الاسم، رقم البطاقة، المواليد).
// الشركة تُختار مرة واحدة للدفعة كاملة. كل صف يُفحص للتكرار بنفس منطق الإضافة
// اليدوية (findDuplicates)؛ الاشتباه يُسجَّل في التقرير ويُتخطى ولا يُضاف تلقائيا
// إلا إن فُعِّل "confirmDuplicates" (إضافة رغم التكرار للكل).
export async function importExcel(prevState, formData) {
  try {
    await requireUser(['tpa']);
    const company = String(formData.get('company') || '').trim();
    const file = formData.get('file');
    const confirmDuplicates = formData.get('confirmDuplicates') === '1';

    if (!company || !file || typeof file === 'string') {
      return { ok: false, message: 'الرجاء اختيار الشركة والملف.' };
    }

    const arrayBuffer = await file.arrayBuffer();
    const wb = XLSX.read(Buffer.from(arrayBuffer), { type: 'buffer', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    let headerIdx = -1;
    let headers = [];
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      const nameCol = findHeaderCol(rows[i], /اسم/);
      const cardCol = findHeaderCol(rows[i], /بطاقة|card/i);
      if (nameCol !== -1 && cardCol !== -1) { headerIdx = i; headers = rows[i]; break; }
    }
    if (headerIdx === -1) {
      return { ok: false, message: 'لم أجد رأسا يحتوي عمودي "الاسم" و"رقم البطاقة". تأكد من القالب.' };
    }

    const nameCol = findHeaderCol(headers, /اسم/);
    const cardCol = findHeaderCol(headers, /بطاقة|card/i);
    const dobCol = findHeaderCol(headers, /ميلاد|مواليد|تاريخ|dob|birth/i);

    const people = await loadLegacyPeople();
    const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();

    const report = [];
    const toAdd = [];
    let nextId = Math.max(0, ...people.map((p) => p.id));

    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row.length) continue;
      const name = cleanName(row[nameCol]);
      const card1 = String(row[cardCol] || '').trim();
      const dob = dobCol !== -1 ? excelDateToStr(row[dobCol]) : '';
      if (!name && !card1) continue; // صف فارغ

      if (!name || !card1) {
        report.push({ row: r + 1, name, card1, dob, status: 'خطأ', reason: 'الاسم أو رقم البطاقة مفقود' });
        continue;
      }

      const dup = findDuplicates([...people, ...toAdd], { name, card1, card2: '', company });
      if (dup.length && !confirmDuplicates) {
        report.push({ row: r + 1, name, card1, dob, status: 'تكرار - تم التخطي', reason: dup.map((d) => `${d.name} (${d.reason})`).join('؛ ') });
        continue;
      }

      nextId += 1;
      const newPerson = {
        id: nextId,
        company,
        companyLabel: COMPANY_LABELS[company] || company,
        name,
        relation: '',
        primaryName: '',
        job: '',
        national: '',
        dob,
        card1,
        card2: '',
        status: '',
        photoSlug: `${safe(name)}_${safe(card1)}`,
        deleted: false,
      };
      toAdd.push(newPerson);
      report.push({ row: r + 1, name, card1, dob, status: dup.length ? 'أُضيف رغم التكرار' : 'أُضيف', reason: dup.length ? dup.map((d) => d.name).join('، ') : '' });
    }

    if (toAdd.length) {
      const merged = [...people, ...toAdd];
      await saveLegacyPeople(merged);
    }

    const summary = {
      total: report.length,
      added: report.filter((r) => r.status.startsWith('أُضيف')).length,
      skipped: report.filter((r) => r.status.startsWith('تكرار')).length,
      errors: report.filter((r) => r.status === 'خطأ').length,
    };

    return { ok: true, message: `تم الاستيراد: ${summary.added} إضافة، ${summary.skipped} تكرار متخطّى، ${summary.errors} خطأ.`, report, summary };
  } catch (err) {
    return { ok: false, message: 'خطأ: ' + err.message };
  }
}

// يضيف قسرا فقط الصفوف التي جرى تخطّيها سابقا بسبب اشتباه تكرار (وليس إعادة
// معالجة الملف كاملا - لتفادي إضافة الصفوف السليمة التي أُضيفت بالفعل مرتين).
export async function forceAddSkippedRows(prevState, formData) {
  try {
    await requireUser(['tpa']);
    const company = String(formData.get('company') || '').trim();
    const rowsJson = String(formData.get('rowsJson') || '[]');
    const rows = JSON.parse(rowsJson);
    if (!company || !Array.isArray(rows) || !rows.length) {
      return { ok: false, message: 'لا توجد صفوف لإضافتها.' };
    }

    const people = await loadLegacyPeople();
    const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
    let nextId = Math.max(0, ...people.map((p) => p.id));

    const toAdd = [];
    for (const r of rows) {
      nextId += 1;
      toAdd.push({
        id: nextId,
        company,
        companyLabel: COMPANY_LABELS[company] || company,
        name: r.name,
        relation: '',
        primaryName: '',
        job: '',
        national: '',
        dob: r.dob || '',
        card1: r.card1,
        card2: '',
        status: '',
        photoSlug: `${safe(r.name)}_${safe(r.card1)}`,
        deleted: false,
      });
    }

    await saveLegacyPeople([...people, ...toAdd]);
    return { ok: true, message: `أُضيف ${toAdd.length} من حالات التكرار المتخطاة.`, addedCount: toAdd.length };
  } catch (err) {
    return { ok: false, message: 'خطأ: ' + err.message };
  }
}

// يستعيد شخصا محذوفا سابقا.
export async function restorePerson(prevState, formData) {
  try {
    await requireUser(['tpa']);
    const id = Number(formData.get('id'));
    if (!id) return { ok: false, message: 'معرّف غير صالح.' };

    const people = await loadLegacyPeople();
    const idx = people.findIndex((p) => p.id === id);
    if (idx === -1) return { ok: false, message: 'الشخص غير موجود.' };

    people[idx].deleted = false;
    delete people[idx].deletedAt;
    await saveLegacyPeople(people);

    return { ok: true, message: 'تمت استعادة البطاقة.', person: people[idx] };
  } catch (err) {
    return { ok: false, message: 'خطأ: ' + err.message };
  }
}
