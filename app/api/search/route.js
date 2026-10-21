import fs from 'fs';
import path from 'path';
import { loadLegacyPeople, saveLegacyPeople } from '../../../lib/beneficiaries.js';
import { STORAGE_DIR } from '../../../lib/photos.js';
import { requireUser } from '../../../lib/auth.js';
import { NextResponse } from 'next/server';

async function loadPeople() {
  return loadLegacyPeople();
}

const CARD_BASE_RE = /^[A-Z]+2025(\d+)/i;
function familyBase(p) {
  const c = p.card1 || p.card2 || '';
  const m = c.match(CARD_BASE_RE);
  return m ? m[1].replace(/^0+/, '') || '0' : '';
}

// يحسب لكل شخص: هل بطاقته مكررة، وهل عائلته (نفس الشركة + نفس رقم البطاقة الأساسي)
// فيها زوج/زوجة مقابل، لدعم فلاتر "بلا زوج/زوجة" و"مكرر".
function annotateFamilyFlags(people) {
  // نتتبّع أصحاب كل رقم بطاقة كمجموعة معرّفات أشخاص فريدة، لا كعدّاد بسيط -
  // حتى لا يُحتسب شخص كتّب نفس الرقم في حقلي "البطاقة الأول والثاني" كتكرار
  // مع نفسه (البطاقة المكررة تعني شخصين مختلفين يحملان نفس الرقم، لا أكثر).
  const cardOwners = new Map();
  for (const p of people) {
    for (const c of [p.card1, p.card2]) {
      if (!c) continue;
      const key = c.toUpperCase();
      if (!cardOwners.has(key)) cardOwners.set(key, new Set());
      cardOwners.get(key).add(p.id);
    }
  }

  const groups = new Map(); // company|base -> [people]
  for (const p of people) {
    const base = familyBase(p);
    if (!base) continue;
    const key = p.company + '|' + base;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  return people.map((p) => {
    const isDuplicateCard = [p.card1, p.card2].some((c) => c && (cardOwners.get(c.toUpperCase())?.size || 0) > 1);
    const base = familyBase(p);
    const family = base ? groups.get(p.company + '|' + base) || [] : [];
    const hasWife = family.some((m) => m.relation === 'زوجة');
    const hasHusbandSide = family.some((m) => m.relation === 'موظف أساسي' || m.relation === 'زوج');
    const isPrimaryOrHusband = p.relation === 'موظف أساسي' || p.relation === 'زوج';
    const noSpouse = isPrimaryOrHusband ? !hasWife : (p.relation === 'زوجة' ? !hasHusbandSide : false);
    return { ...p, isDuplicateCard, noSpouse };
  });
}

function normalize(s) {
  return String(s || '')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ىئ]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const PAGE_SIZE = 40;

const CARD_NUM_RE = /^[A-Z]+20250*(\d+)([A-Z]+\d*)?$/i;
function cardNumericPart(card) {
  const m = String(card || '').trim().match(CARD_NUM_RE);
  return m ? m[1] : null;
}

export async function GET(request) {
  try {
    await requireUser(['tpa']);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 403 });
  }
  const { searchParams } = new URL(request.url);
  const qRaw = String(searchParams.get('q') || '').trim();
  const q = normalize(qRaw);
  const isNumericQuery = /^\d+$/.test(qRaw);
  const exactNum = searchParams.get('exactNum') === '1';
  const company = searchParams.get('company') || '';
  const relation = searchParams.get('relation') || '';
  const photo = searchParams.get('photo') || ''; // '', 'has', 'missing'
  const special = searchParams.get('special') || ''; // '', 'husband_no_wife', 'wife_no_husband', 'duplicate'
  const deletedFilter = searchParams.get('deleted') || ''; // '' = إخفاء المحذوف (افتراضي), 'only' = المحذوف فقط, 'all' = الكل
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));

  const all = await loadPeople();
  // حساب علامات العائلة (مكرر/بلا زوج) على الأشخاص غير المحذوفين فقط، حتى لا
  // تُحتسب سجلات محذوفة ضمن التكرار أو تواجد الزوج/الزوجة.
  const active = annotateFamilyFlags(all.filter((p) => !p.deleted));
  const deletedOnes = all.filter((p) => p.deleted).map((p) => ({ ...p, isDuplicateCard: false, noSpouse: false }));

  let people;
  if (deletedFilter === 'only') people = deletedOnes;
  else if (deletedFilter === 'all') people = [...active, ...deletedOnes];
  else people = active;

  let results = people;
  if (company) results = results.filter((p) => p.company === company);
  if (relation) results = results.filter((p) => p.relation === relation);
  if (special === 'husband_no_wife') {
    results = results.filter((p) => (p.relation === 'موظف أساسي' || p.relation === 'زوج') && p.noSpouse);
  } else if (special === 'wife_no_husband') {
    results = results.filter((p) => p.relation === 'زوجة' && p.noSpouse);
  } else if (special === 'duplicate') {
    results = results.filter((p) => p.isDuplicateCard);
    // رتّب حسب رقم البطاقة نفسه حتى يظهر كل من يحمل نفس الرقم متتاليين
    // بجانب بعضهم، بدل تشتّتهم عشوائيا عبر الصفحات.
    results = [...results].sort((a, b) => {
      const ca = (a.card1 || a.card2 || '').toUpperCase();
      const cb = (b.card1 || b.card2 || '').toUpperCase();
      return ca < cb ? -1 : ca > cb ? 1 : 0;
    });
  } else if (special === 'wife_multi_card') {
    // زوجات لهن بطاقتان مختلفتان (رقم البطاقة الأول يختلف عن الثاني لنفس الشخص)
    results = results.filter((p) =>
      p.relation === 'زوجة' && p.card1 && p.card2 && p.card1.trim().toUpperCase() !== p.card2.trim().toUpperCase()
    );
  } else if (special === 'same_two_cards') {
    // نفس الشخص مسجَّل له نفس رقم البطاقة حرفيا في الحقلين الأول والثاني -
    // إدخال عبثي/مكرر بلا داعٍ (وليس بطاقة ثانية حقيقية).
    results = results.filter((p) =>
      p.card1 && p.card2 && p.card1.trim().toUpperCase() === p.card2.trim().toUpperCase()
    );
  } else if (special === 'batch1') {
    // الدفعة الأولى (جليانة): الأشخاص الموسومون batch=1 من قائمة الدفعة الأولى المعتمدة
    results = results.filter((p) => p.batch === 1);
  } else if (special === 'has_two_cards') {
    // كل شخص مسجَّل له رقما بطاقة (الحقلان معا غير فارغين)، سواء تطابقا أو اختلفا.
    results = results.filter((p) => p.card1 && p.card2);
  }
  if (q && isNumericQuery && exactNum) {
    // بحث دقيق: يطابق فقط الرقم التسلسلي الفعلي داخل رقم البطاقة (بلا صفر بادئ)،
    // وليس أي رقم يحتوي هذه الأرقام كجزء منه (وظيفي/وطني/جزء من رقم أطول).
    const target = qRaw.replace(/^0+/, '') || '0';
    results = results.filter((p) =>
      [p.card1, p.card2].some((c) => {
        const n = cardNumericPart(c);
        return n !== null && (n.replace(/^0+/, '') || '0') === target;
      })
    );
  } else if (q && isNumericQuery) {
    // استعلام رقمي عادي: يقارن برقم البطاقة فقط (وليس الرقم الوظيفي/الوطني)
    // تجنبا لنتائج مضللة (مثل بحث "788" يطابق رقماً وطنياً ينتهي بـ788 لشخص غير مرتبط إطلاقا).
    results = results.filter((p) => (p.card1 || '').includes(qRaw) || (p.card2 || '').includes(qRaw));
  } else if (q) {
    results = results.filter((p) => {
      const hay = normalize(p.name + ' ' + p.card1 + ' ' + p.card2 + ' ' + p.job + ' ' + p.national);
      return hay.includes(q);
    });
  }

  // أضف hasPhoto لكل النتائج المطابقة (قبل فلترة الصورة، لأن الفلترة تعتمد عليها)
  results = results.map((p) => {
    const photoPath = path.join(STORAGE_DIR, p.company, `${p.photoSlug}.webp`);
    return { ...p, hasPhoto: fs.existsSync(photoPath) };
  });

  if (photo === 'has') results = results.filter((p) => p.hasPhoto);
  else if (photo === 'missing') results = results.filter((p) => !p.hasPhoto);

  const total = results.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const pageResults = results.slice(start, start + PAGE_SIZE);

  return NextResponse.json({ total, page: safePage, totalPages, pageSize: PAGE_SIZE, results: pageResults });
}
