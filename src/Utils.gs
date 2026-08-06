/**
 * Utils.gs
 * ฟังก์ชันช่วยเหลือทั่วไป (pure functions ส่วนใหญ่ ทดสอบด้วย Node ได้)
 */

/** สร้าง id แบบสุ่มพร้อม prefix เช่น genId_('job') -> 'job_xxxxx' */
function genId_(prefix) {
  var rand = Math.random().toString(36).substring(2, 10);
  var ts = Date.now().toString(36);
  return (prefix ? prefix + '_' : '') + ts + rand;
}

/** timestamp ISO ปัจจุบัน */
function nowIso_() {
  return new Date().toISOString();
}

/**
 * แปลง 'HH:MM:SS' -> จำนวนวินาที (integer)
 * รองรับ 'MM:SS' ด้วย (เผื่อ transcript บางแบบ) แต่ระบบหลักบังคับ HH:MM:SS
 * คืน null ถ้า format ไม่ถูกต้อง
 */
function timestampToSeconds_(ts) {
  if (ts === null || ts === undefined) return null;
  var s = String(ts).trim();
  var m = s.match(/^(\d{1,2}):([0-5]?\d):([0-5]?\d)$/);
  if (m) {
    return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
  }
  var m2 = s.match(/^([0-5]?\d):([0-5]?\d)$/);
  if (m2) {
    return parseInt(m2[1], 10) * 60 + parseInt(m2[2], 10);
  }
  return null;
}

/** แปลงวินาที -> 'HH:MM:SS' */
function secondsToTimestamp_(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined || isNaN(totalSeconds)) return '';
  var s = Math.max(0, Math.floor(totalSeconds));
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var sec = s % 60;
  return pad2_(h) + ':' + pad2_(m) + ':' + pad2_(sec);
}

/** เติม 0 หน้าเลขให้ครบ 2 หลัก */
function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

/** ตรวจว่า string เป็นรูปแบบ HH:MM:SS ที่ถูกต้อง */
function isValidHms_(ts) {
  return /^\d{1,2}:[0-5]\d:[0-5]\d$/.test(String(ts || '').trim());
}

/** parse JSON แบบปลอดภัย คืน fallback ถ้า error */
function safeJsonParse_(str, fallback) {
  if (str === null || str === undefined || str === '') {
    return fallback === undefined ? null : fallback;
  }
  try {
    return JSON.parse(str);
  } catch (e) {
    return fallback === undefined ? null : fallback;
  }
}

/** stringify แบบปลอดภัย */
function safeJsonStringify_(obj) {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    return '';
  }
}

/** normalize email เป็นตัวพิมพ์เล็ก + trim */
function normalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

/** นับจำนวนคำแบบง่าย (รองรับไทย-อังกฤษปน): นับ token ที่ไม่ใช่ whitespace */
function countWords_(text) {
  var t = String(text || '').trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(function (w) { return w.length > 0; }).length;
}

/** นับจำนวนตัวอักษร (ไม่รวมช่องว่างหัวท้าย) */
function countChars_(text) {
  return String(text || '').trim().length;
}

/** ดึง Drive folder id จาก URL หรือ id ตรง ๆ (คืน '' ถ้าแกะไม่ได้) */
function extractFolderId_(urlOrId) {
  var s = String(urlOrId || '').trim();
  if (!s) return '';
  var m = s.match(/[-\w]{25,}/);
  return m ? m[0] : '';
}

// รองรับการ import ใน Node สำหรับการทดสอบ (ไม่มีผลใน Apps Script)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    genId_: genId_,
    timestampToSeconds_: timestampToSeconds_,
    secondsToTimestamp_: secondsToTimestamp_,
    isValidHms_: isValidHms_,
    safeJsonParse_: safeJsonParse_,
    safeJsonStringify_: safeJsonStringify_,
    normalizeEmail_: normalizeEmail_,
    countWords_: countWords_,
    countChars_: countChars_,
    extractFolderId_: extractFolderId_,
    pad2_: pad2_
  };
}
