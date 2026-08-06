/**
 * TranscriptService.gs
 * แปลง Transcript (ข้อความดิบ) -> โครงสร้าง JSON
 *
 * แยก parsing logic ออกจาก business logic อย่างชัดเจน:
 *   parseTranscript() เป็น pure function -> ทดสอบด้วย Node ได้
 *
 * รองรับรูปแบบ:
 *   [HH:MM:SS] Speaker: Text          (ข้อความอาจอยู่บรรทัดถัดไป)
 *   HH:MM:SS Speaker: Text
 * ผู้พูดเดียวกันพูดหลายบรรทัด -> รวมเป็นรายการเดียวจนกว่าจะเจอ timestamp ใหม่
 */

/** regex ตรวจจับบรรทัดหัวรายการ (ขึ้นต้นด้วย timestamp) */
var TX_HEADER_RE = /^\s*\[?\s*(\d{1,2}:\d{2}:\d{2})\s*\]?\s*(.*)$/;

/**
 * parse transcript -> { rows, count, maxSeconds, maxTimestamp, warnings }
 * แต่ละ row: { id, timestamp, timestampSeconds, speaker, text }
 */
function parseTranscript(transcriptText) {
  var text = String(transcriptText === null || transcriptText === undefined ? '' : transcriptText);
  var lines = text.replace(/\r\n?/g, '\n').split('\n');
  var rows = [];
  var warnings = [];
  var current = null;
  var sawHeader = false;
  var preHeaderText = false;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var m = line.match(TX_HEADER_RE);
    if (m) {
      // ปิดรายการก่อนหน้า
      if (current) rows.push(finalizeRow_(current));
      sawHeader = true;
      var ts = m[1];
      var rest = m[2] || '';
      var speaker = '';
      var inline = '';
      var colon = rest.indexOf(':');
      if (colon >= 0) {
        speaker = rest.slice(0, colon).trim();
        inline = rest.slice(colon + 1).trim();
      } else {
        speaker = rest.trim();
        inline = '';
      }
      current = {
        id: rows.length,
        timestamp: ts,
        timestampSeconds: timestampToSeconds_(ts),
        speaker: speaker,
        textLines: inline ? [inline] : []
      };
    } else {
      // บรรทัดต่อเนื่อง
      var trimmed = line.trim();
      if (!trimmed) continue; // ข้ามบรรทัดว่าง
      if (current) {
        current.textLines.push(trimmed);
      } else if (!sawHeader) {
        preHeaderText = true;
      }
    }
  }
  if (current) rows.push(finalizeRow_(current));

  // reindex id ให้ต่อเนื่อง
  rows.forEach(function (r, idx) { r.id = idx; });

  // warnings
  if (preHeaderText) warnings.push('พบข้อความก่อน timestamp แรก — ถูกข้ามไป');
  var emptyText = rows.filter(function (r) { return !r.text; }).length;
  if (emptyText) warnings.push('มี ' + emptyText + ' รายการที่ไม่มีเนื้อหาข้อความ');
  var badTs = rows.filter(function (r) { return r.timestampSeconds === null; }).length;
  if (badTs) warnings.push('มี ' + badTs + ' รายการที่ timestamp ผิดรูปแบบ');

  var maxSeconds = 0;
  rows.forEach(function (r) {
    if (r.timestampSeconds !== null && r.timestampSeconds > maxSeconds) maxSeconds = r.timestampSeconds;
  });

  return {
    rows: rows,
    count: rows.length,
    maxSeconds: maxSeconds,
    maxTimestamp: secondsToTimestamp_(maxSeconds),
    warnings: warnings
  };
}

/** รวม textLines เป็น text เดียว + ตัด field ชั่วคราวออก */
function finalizeRow_(r) {
  return {
    id: r.id,
    timestamp: r.timestamp,
    timestampSeconds: r.timestampSeconds,
    speaker: r.speaker,
    text: (r.textLines || []).join('\n').trim()
  };
}

// ---- Public API ----

/** endpoint: parse บน server (ต้องล็อกอิน) */
function apiParseTranscript(transcriptText) {
  requireUser_();
  return parseTranscript(transcriptText);
}

// รองรับ Node test
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseTranscript: parseTranscript, TX_HEADER_RE: TX_HEADER_RE };
}
