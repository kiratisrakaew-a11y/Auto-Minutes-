/**
 * AgendaService.gs
 * จัดการวาระ/หัวข้อของ job + หั่น transcript ตามหัวข้อ
 *
 * หน่วยของการหั่นและการสรุปคือ "หัวข้อ" (topic) ไม่ใช่ "วาระ" (agenda)
 * 1 วาระมีได้หลายหัวข้อ; แต่ละหัวข้อมีช่วงเวลาของตัวเอง
 *
 * splitTranscriptByTopic() เป็น pure function -> ทดสอบด้วย Node ได้
 */

/**
 * แปลงโครงสร้าง agendas แบบซ้อน (จาก client) -> flat topic list
 * agendas = [{ agenda_no, agenda_title, summary_instruction,
 *              topics: [{ topic_no, topic_title, note, start_time, end_time }] }]
 */
function flattenAgendas_(agendas) {
  var flat = [];
  (agendas || []).forEach(function (ag) {
    (ag.topics || []).forEach(function (tp) {
      flat.push({
        agenda_no: String(ag.agenda_no || ''),
        agenda_title: ag.agenda_title || '',
        summary_instruction: ag.summary_instruction || '',
        topic_no: String(tp.topic_no || ''),
        topic_title: tp.topic_title || '',
        note: tp.note || '',
        start_time: (tp.start_time || '').trim(),
        end_time: (tp.end_time || '').trim(),
        key: String(tp.topic_no || '')
      });
    });
  });
  return flat;
}

/**
 * หั่น transcript ตามช่วงเวลาหัวข้อ (pure)
 * @param {Array} rows    transcript rows [{id,timestampSeconds,...}]
 * @param {Array} topics  normalized topics [{topic_no,start_seconds,end_seconds}]
 * @return {Array} rows ใหม่ (clone) พร้อม field topicKey (topic_no ที่ครอบคลุม หรือ null)
 */
function splitTranscriptByTopic(rows, topics) {
  var ranges = (topics || []).map(function (t) {
    return {
      topic_no: t.topic_no,
      start_seconds: toSecondsNum_(t.start_seconds),
      end_seconds: toSecondsNum_(t.end_seconds)
    };
  }).filter(function (t) {
    return t.start_seconds !== null && t.end_seconds !== null && t.start_seconds < t.end_seconds;
  }).sort(function (a, b) { return a.start_seconds - b.start_seconds; });

  return (rows || []).map(function (r) {
    var key = null;
    // timestampSeconds เป็นตัวตั้ง; ถ้าใช้ไม่ได้ (null/เพี้ยน) derive จาก timestamp string
    var ts = toSecondsNum_(r.timestampSeconds);
    if (ts === null) ts = timestampToSeconds_(r.timestamp);
    if (ts !== null) {
      for (var i = 0; i < ranges.length; i++) {
        if (ts >= ranges[i].start_seconds && ts < ranges[i].end_seconds) {
          key = String(ranges[i].topic_no);
          break;
        }
      }
    }
    return {
      id: r.id, timestamp: r.timestamp, timestampSeconds: ts,
      speaker: r.speaker, text: r.text,
      topicKey: key, excluded: false
    };
  });
}

/** จัดกลุ่ม rows ตาม topicKey -> { topicKey: [rows] } */
function groupRowsByTopic_(rows) {
  var map = {};
  (rows || []).forEach(function (r) {
    var k = r.topicKey || '__unassigned';
    if (!map[k]) map[k] = [];
    map[k].push(r);
  });
  return map;
}

// ---- Public API ----

/**
 * ตรวจสอบช่วงเวลา (ไม่บันทึก) — คืน errors/warnings + จำนวน transcript ที่ยังไม่ถูกจัด
 */
function apiValidateAgenda(jobId, agendas) {
  var user = requireUser_();
  var job = loadOwnedJob_(jobId, user);
  var flat = flattenAgendas_(agendas);
  var transcript = safeJsonParse_(job.transcript_json, { rows: [], maxSeconds: 0 });
  var result = validateTopicRanges(flat, transcript.maxSeconds || 0);
  var unassigned = findUnassignedRows(transcript.rows || [], result.normalized);
  return {
    valid: result.valid,
    errors: result.errors,
    warnings: result.warnings,
    unassignedCount: unassigned.length,
    maxTimestamp: secondsToTimestamp_(transcript.maxSeconds || 0)
  };
}

/**
 * บันทึกวาระ/หัวข้อ + หั่น transcript แล้วคืนผลแบบจัดกลุ่ม
 * บล็อกถ้ามี error (แต่ warning ผ่านได้)
 */
function apiSaveTopicsAndSplit(jobId, agendas) {
  var user = requireUser_();
  var job = loadOwnedJob_(jobId, user);
  var flat = flattenAgendas_(agendas);
  if (!flat.length) throw new Error('ต้องมีอย่างน้อย 1 หัวข้อ');

  var transcript = safeJsonParse_(job.transcript_json, { rows: [], maxSeconds: 0 });
  var result = validateTopicRanges(flat, transcript.maxSeconds || 0);
  if (!result.valid) {
    throw new Error('ช่วงเวลายังไม่ถูกต้อง:\n- ' + result.errors.join('\n- '));
  }

  // บันทึก topics ลง sheet
  saveJobTopics_(jobId, flat, result.normalized);

  // หั่น transcript ตามเวลา แล้ว persist rows พร้อม topicKey
  var splitRows = splitTranscriptByTopic(transcript.rows || [], result.normalized);
  transcript.rows = splitRows;
  updateRowByNumber_(SHEETS.MEETING_JOBS, job.__row, {
    transcript_json: safeJsonStringify_(transcript),
    status: JOB_STATUS.READY_FOR_PROCESSING,
    expires_at: computeExpiry_(),
    updated_at: nowIso_()
  });
  writeAuditLog('SAVE_TOPICS', { job_id: jobId, topics: flat.length });

  return getMeetingJob(jobId);
}

/**
 * บันทึกการแก้ transcript ใน preview (ยึดการแก้ของ user)
 * rows = [{id,timestamp,timestampSeconds,speaker,text,topicKey,excluded}]
 */
function apiSavePreview(jobId, rows) {
  var user = requireUser_();
  var job = loadOwnedJob_(jobId, user);
  var transcript = safeJsonParse_(job.transcript_json, { rows: [] });
  transcript.rows = (rows || []).map(function (r) {
    return {
      id: r.id, timestamp: r.timestamp, timestampSeconds: r.timestampSeconds,
      speaker: r.speaker, text: r.text,
      topicKey: r.topicKey || null, excluded: !!r.excluded
    };
  });
  updateRowByNumber_(SHEETS.MEETING_JOBS, job.__row, {
    transcript_json: safeJsonStringify_(transcript),
    expires_at: computeExpiry_(),
    updated_at: nowIso_()
  });
  writeAuditLog('SAVE_PREVIEW', { job_id: jobId, rows: transcript.rows.length });
  return { ok: true };
}

// ---- helpers ----

/** เขียน topics ทั้งชุด (ลบเดิม เขียนใหม่) โดย merge start/end seconds ที่ normalize แล้ว */
function saveJobTopics_(jobId, flat, normalized) {
  // ลบ topics เดิมของ job (ล่างขึ้นบน)
  readWhere_(SHEETS.MEETING_TOPICS, function (t) { return t.job_id === jobId; })
    .sort(function (a, b) { return b.__row - a.__row; })
    .forEach(function (r) { deleteRowByNumber_(SHEETS.MEETING_TOPICS, r.__row); });

  var normByKey = {};
  (normalized || []).forEach(function (n) { normByKey[String(n.key)] = n; });

  var now = nowIso_();
  flat.forEach(function (t, i) {
    var n = normByKey[String(t.key)] || {};
    appendRow_(SHEETS.MEETING_TOPICS, {
      job_id: jobId,
      agenda_no: t.agenda_no,
      agenda_title: t.agenda_title,
      summary_instruction: t.summary_instruction,
      topic_no: t.topic_no,
      topic_title: t.topic_title,
      note: t.note,
      start_time: t.start_time,
      end_time: t.end_time,
      start_seconds: n.start_seconds !== undefined && n.start_seconds !== null ? n.start_seconds : '',
      end_seconds: n.end_seconds !== undefined && n.end_seconds !== null ? n.end_seconds : '',
      ai_status: AI_STATUS.PENDING,
      ai_result_json: '',
      user_edited_result_json: '',
      approved: false,
      sort_order: i + 1,
      updated_at: now
    });
  });
}

/**
 * ดึง transcript rows ของหัวข้อหนึ่ง (ไม่รวม excluded) สำหรับส่งให้ AI
 * รับทั้งแถวที่ topicKey ตรง และแถวที่ยังไม่มี topicKey แต่เวลาอยู่ในช่วงของหัวข้อ
 * (กันเคส server split เก็บ topicKey ไม่ครบ -> AI ได้ transcript ว่าง)
 */
function getTopicTranscriptRows_(job, topicNo) {
  var transcript = safeJsonParse_(job.transcript_json, { rows: [] });
  var rows = transcript.rows || [];
  // หาช่วงเวลาของหัวข้อนี้
  var st = null, en = null;
  try {
    var tr = findTopicRow_(job.job_id, topicNo);
    st = toSecondsNum_(tr.start_seconds);
    en = toSecondsNum_(tr.end_seconds);
  } catch (e) { /* ไม่พบ topic -> ใช้เฉพาะ topicKey */ }

  return rows.filter(function (r) {
    if (r.excluded) return false;
    if (String(r.topicKey) === String(topicNo)) return true;
    // fallback: แถวที่ยังไม่ถูก assign หัวข้อใด + เวลาอยู่ในช่วง
    var noKey = r.topicKey === null || r.topicKey === undefined || r.topicKey === '';
    if (noKey && st !== null && en !== null) {
      var ts = toSecondsNum_(r.timestampSeconds);
      if (ts === null) ts = timestampToSeconds_(r.timestamp);
      return ts !== null && ts >= st && ts < en;
    }
    return false;
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    splitTranscriptByTopic: splitTranscriptByTopic,
    flattenAgendas_: flattenAgendas_
  };
}
