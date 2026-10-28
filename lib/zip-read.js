// قارئ ZIP صغير يقرأ من الملف مباشرة (بلا تحميله كاملًا في الذاكرة): يدعم التخزين والضغط deflate وZIP64.
import fs from 'node:fs';
import zlib from 'node:zlib';

function readAt(fd, pos, len) {
  const buf = Buffer.alloc(len);
  let got = 0;
  while (got < len) {
    const n = fs.readSync(fd, buf, got, len - got, pos + got);
    if (!n) break;
    got += n;
  }
  return buf.subarray(0, got);
}

const u64 = (b, o) => Number(b.readBigUInt64LE(o));

export function openZip(file) {
  const fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;
  const tailLen = Math.min(size, 65557);
  const tail = readAt(fd, size - tailLen, tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) { fs.closeSync(fd); throw new Error('الملف ليس ملفًا مضغوطًا ZIP صالحًا.'); }
  let count = tail.readUInt16LE(eocd + 10);
  let cdSize = tail.readUInt32LE(eocd + 12);
  let cdOffset = tail.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff || count === 0xffff) {
    const loc = eocd - 20;
    if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) { fs.closeSync(fd); throw new Error('ملف ZIP64 غير مكتمل.'); }
    const z = readAt(fd, u64(tail, loc + 8), 56);
    count = u64(z, 32);
    cdSize = u64(z, 40);
    cdOffset = u64(z, 48);
  }

  const cd = readAt(fd, cdOffset, cdSize);
  const entries = [];
  for (let p = 0, i = 0; i < count && p + 46 <= cd.length; i++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) break;
    const flags = cd.readUInt16LE(p + 8);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    let size = cd.readUInt32LE(p + 24);
    let compSize = cd.readUInt32LE(p + 20);
    let offset = cd.readUInt32LE(p + 42);
    const nameBuf = cd.subarray(p + 46, p + 46 + nameLen);
    // حقل ZIP64 الإضافي يحمل القيم التي امتلأت (0xffffffff) بالترتيب: الحجم، المضغوط، الموضع.
    for (let e = p + 46 + nameLen, end = e + extraLen; e + 4 <= end;) {
      const id = cd.readUInt16LE(e);
      const len = cd.readUInt16LE(e + 2);
      if (id === 1) {
        let q = e + 4;
        if (size === 0xffffffff) { size = u64(cd, q); q += 8; }
        if (compSize === 0xffffffff) { compSize = u64(cd, q); q += 8; }
        if (offset === 0xffffffff) offset = u64(cd, q);
      }
      e += 4 + len;
    }
    entries.push({
      name: flags & 0x800 ? nameBuf.toString('utf8') : nameBuf.toString('latin1'),
      dir: nameBuf[nameBuf.length - 1] === 0x2f,
      encrypted: !!(flags & 1),
      method: cd.readUInt16LE(p + 10),
      size,
      compSize,
      offset,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }

  return {
    entries,
    read(entry) {
      if (entry.encrypted) throw new Error('الملف محمي بكلمة مرور.');
      const head = readAt(fd, entry.offset, 30);
      if (head.readUInt32LE(0) !== 0x04034b50) throw new Error('بيانات تالفة داخل الملف المضغوط.');
      const data = readAt(fd, entry.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28), entry.compSize);
      if (entry.method === 0) return data;
      if (entry.method === 8) return zlib.inflateRawSync(data);
      throw new Error('طريقة ضغط غير مدعومة.');
    },
    close() {
      fs.closeSync(fd);
    },
  };
}
