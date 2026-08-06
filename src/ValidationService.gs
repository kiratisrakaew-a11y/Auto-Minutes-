/**
 * ValidationService.gs
 * ตรวจสอบความถูกต้องของช่วงเวลาหัวข้อ (pure functions -> ทดสอบด้วย Node ได้)
 *
 * กติกา (ยึดหน่วยเป็น "หัวข้อ" ไม่ใช่ "วาระ"):
 *  - เวลาอยู่ในรูปแบบ HH:MM:SS
 *  - start < end
 *  - ช่วงเวลาแต่ละหัวข้อต้องไม่ทับกัน
 *  - เวลาต้องไม่เกิน timestamp สูงสุดของ transcript
 *  - เตือนถ้ามีช่องว่างระหว่างหัวข้อ / มี transcript ที่ไม่ถูกจัดเข้าหัวข้อใด
 */

/**
 * ตรวจสอบรายการหัวข้อทั้งหมด
 * @param {Array} topics  [{ key, agenda_no, topic_no, topic_title, start_time, end_time }]
 * @param {number} transcriptMaxSeconds  วินาทีสูงสุดของ transcript (0 = ไม่ตรวจ)
 * @return {Object} { valid, errors:[], warnings:[], normalized:[{...,start_seconds,end_seconds}] }
 */
function validateTopicRanges(topics, transcriptMaxSeconds) {
  var errors = [];
  var warnings = [];
  var normalized = [];
  topics = topics || [];

  // 1) format + start<end + ไม่เกิน max
  topics.forEach(function (t, i) {
    var label = topicLabel_(t, i);
    var s = t.start_time, e = t.end_time;
    if (!isValidHms_(s)) { errors.push(label + ': เวลาเริ่ม "' + (s || '') + '" ไม่อยู่ในรูปแบบ HH:MM:SS'); }
    if (!isValidHms_(e)) { errors.push(label + ': เวลาสิ้นสุด "' + (e || '') + '" ไม่อยู่ในรูปแบบ HH:MM:SS'); }
    var ss = timestampToSeconds_(s);
    var es = timestampToSeconds_(e);
    if (ss !== null && es !== null && ss >= es) {
      errors.push(label + ': เวลาเริ่มต้องน้อยกว่าเวลาสิ้นสุด');
    }
    if (transcriptMaxSeconds && es !== null && es > transcriptMaxSeconds) {
      errors.push(label + ': เวลาสิ้นสุด (' + s2t_(es) + ') เกินความยาว transcript (' + s2t_(transcriptMaxSeconds) + ')');
    }
    normalized.push({
      key: t.key !== undefined ? t.key : i,
      agenda_no: t.agenda_no, topic_no: t.topic_no, topic_title: t.topic_title,
      start_time: s, end_time: e, start_seconds: ss, end_seconds: es
    });
  });

  // 2) overlap — เรียงตาม start แล้วเทียบคู่ที่ติดกัน
  var ranges = normalized.filter(function (r) {
    return r.start_seconds !== null && r.end_seconds !== null && r.start_seconds < r.end_seconds;
  }).slice().sort(function (a, b) { return a.start_seconds - b.start_seconds; });

  for (var j = 1; j < ranges.length; j++) {
    var prev = ranges[j - 1], cur = ranges[j];
    if (cur.start_seconds < prev.end_seconds) {
      errors.push('ช่วงเวลาทับกัน: "' + topicLabel_(prev) + '" (' + s2t_(prev.start_seconds) + '-' + s2t_(prev.end_seconds) +
        ') กับ "' + topicLabel_(cur) + '" (' + s2t_(cur.start_seconds) + '-' + s2t_(cur.end_seconds) + ')');
    } else if (cur.start_seconds > prev.end_seconds) {
      warnings.push('มีช่องว่างระหว่าง "' + topicLabel_(prev) + '" ถึง "' + topicLabel_(cur) + '" (' +
        s2t_(prev.end_seconds) + ' → ' + s2t_(cur.start_seconds) + ')');
    }
  }

  return { valid: errors.length === 0, errors: errors, warnings: warnings, normalized: normalized };
}

/**
 * หา transcript rows ที่ไม่ถูกจัดเข้าหัวข้อใดเลย (สำหรับเตือน)
 * @return {Array} rows ที่ไม่มีหัวข้อครอบคลุม
 */
function findUnassignedRows(transcriptRows, normalizedTopics) {
  var ranges = (normalizedTopics || []).filter(function (r) {
    return r.start_seconds !== null && r.end_seconds !== null;
  });
  return (transcriptRows || []).filter(function (row) {
    if (row.timestampSeconds === null || row.timestampSeconds === undefined) return false;
    var covered = ranges.some(function (r) {
      return row.timestampSeconds >= r.start_seconds && row.timestampSeconds < r.end_seconds;
    });
    return !covered;
  });
}

// ---- helpers ----
function topicLabel_(t, i) {
  var no = t.topic_no || (t.agenda_no ? t.agenda_no : (i !== undefined ? (i + 1) : ''));
  var title = t.topic_title ? (' ' + t.topic_title) : '';
  return 'หัวข้อ ' + no + title;
}
function s2t_(sec) { return secondsToTimestamp_(sec); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    validateTopicRanges: validateTopicRanges,
    findUnassignedRows: findUnassignedRows
  };
}
