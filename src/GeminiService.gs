/**
 * GeminiService.gs
 * เชื่อม Gemini API (ผ่าน UrlFetchApp) + สร้าง prompt + validate/repair JSON + retry
 * รองรับ mock mode (USE_MOCK_GEMINI=true) เพื่อทดสอบ flow โดยไม่ยิง API จริง
 *
 * ประมวลผล "ทีละหัวข้อ" ตามที่ client queue เรียกมา -> เลี่ยง timeout + resume ได้
 */

/** endpoint URL ของ Gemini generateContent */
function geminiEndpoint_(model, apiKey) {
  return 'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
}

/**
 * สรุปหัวข้อหนึ่งด้วย AI -> คืน object ตาม schema
 * @param {Object} topicMeta { agenda_no, agenda_title, topic_no, topic_title, summary_instruction, note }
 * @param {Array} rows transcript rows [{timestamp,speaker,text}]
 */
function geminiSummarizeTopic_(topicMeta, rows) {
  if (getBoolConfig_(PROP_KEYS.USE_MOCK_GEMINI)) {
    return mockSummarize_(topicMeta, rows);
  }
  // เลือก provider — 'openai' = OpenAI-compatible (เช่น OKMD/KKU)
  var provider = String(getConfig_(PROP_KEYS.AI_PROVIDER) || CONFIG_DEFAULTS.AI_PROVIDER).toLowerCase();
  if (provider === 'openai') {
    return openaiSummarizeTopic_(topicMeta, rows);
  }
  var apiKey = getConfig_(PROP_KEYS.GEMINI_API_KEY);
  if (!apiKey) throw new Error('ยังไม่ได้ตั้งค่า GEMINI_API_KEY (หรือเปิด USE_MOCK_GEMINI=true เพื่อทดสอบ)');
  var model = getConfig_(PROP_KEYS.GEMINI_MODEL) || CONFIG_DEFAULTS.GEMINI_MODEL;
  var prompt = buildTopicPrompt_(topicMeta, rows);

  var payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
  };
  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  // retry 1 ครั้ง (รวมยิง 2 ครั้ง) ตาม decision
  var lastErr = null;
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      var resp = UrlFetchApp.fetch(geminiEndpoint_(model, apiKey), options);
      var code = resp.getResponseCode();
      var body = resp.getContentText();
      if (code < 200 || code >= 300) {
        throw new Error('Gemini API error ' + code + ': ' + body.slice(0, 300));
      }
      var data = JSON.parse(body);
      var textOut = extractGeminiText_(data);
      var parsed = parseAiJson_(textOut);
      return normalizeAiResult_(parsed, topicMeta);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error('AI ประมวลผลไม่สำเร็จหลังลองซ้ำ: ' + (lastErr && lastErr.message));
}

/**
 * สรุปหัวข้อผ่าน OpenAI-compatible API (เช่น OKMD/KKU)
 * POST {base}/chat/completions, Authorization: Bearer <key>
 */
function openaiSummarizeTopic_(topicMeta, rows) {
  var base = String(getConfig_(PROP_KEYS.OPENAI_BASE_URL) || '').replace(/\/+$/, '');
  var apiKey = getConfig_(PROP_KEYS.OPENAI_API_KEY);
  var model = getConfig_(PROP_KEYS.OPENAI_MODEL);
  if (!base) throw new Error('ยังไม่ได้ตั้งค่า OPENAI_BASE_URL');
  if (!apiKey) throw new Error('ยังไม่ได้ตั้งค่า OPENAI_API_KEY');
  if (!model) throw new Error('ยังไม่ได้ตั้งค่า OPENAI_MODEL (ดูชื่อโมเดลจากแท็บ Models ของ provider)');

  var prompt = buildTopicPrompt_(topicMeta, rows);
  var payload = {
    model: model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: 'คุณเป็นเลขานุการมืออาชีพ ตอบเป็น JSON ตาม schema ที่ผู้ใช้กำหนดเท่านั้น' },
      { role: 'user', content: prompt }
    ]
  };
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var url = base + '/chat/completions';
  var lastErr = null;
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      var resp = UrlFetchApp.fetch(url, options);
      var code = resp.getResponseCode();
      var body = resp.getContentText();
      if (code < 200 || code >= 300) {
        throw new Error('AI API error ' + code + ': ' + body.slice(0, 300));
      }
      var data = JSON.parse(body);
      var textOut = extractOpenaiText_(data);
      var parsed = parseAiJson_(textOut);
      return normalizeAiResult_(parsed, topicMeta);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error('AI ประมวลผลไม่สำเร็จหลังลองซ้ำ: ' + (lastErr && lastErr.message));
}

/** ดึงข้อความจาก response ของ OpenAI-compatible */
function extractOpenaiText_(data) {
  if (!data || !data.choices || !data.choices.length) {
    throw new Error('AI ไม่คืนผลลัพธ์ (choices ว่าง)');
  }
  var msg = data.choices[0].message;
  var text = msg && (typeof msg.content === 'string' ? msg.content
    : (Array.isArray(msg.content) ? msg.content.map(function (p) { return p.text || ''; }).join('') : ''));
  if (!text) throw new Error('AI คืนผลลัพธ์ว่าง');
  return text;
}

/** ดึงข้อความจาก response ของ Gemini */
function extractGeminiText_(data) {
  if (!data || !data.candidates || !data.candidates.length) {
    throw new Error('Gemini ไม่คืนผลลัพธ์ (candidates ว่าง)');
  }
  var parts = data.candidates[0].content && data.candidates[0].content.parts;
  if (!parts || !parts.length) throw new Error('Gemini คืนผลลัพธ์ว่าง');
  return parts.map(function (p) { return p.text || ''; }).join('');
}

/** สร้าง prompt สำหรับสรุปหัวข้อ (บังคับ JSON-only + กติกากันการเดา) */
function buildTopicPrompt_(topicMeta, rows) {
  var transcript = (rows || []).map(function (r) {
    return '[' + (r.timestamp || '') + '] ' + (r.speaker || '?') + ': ' + (r.text || '');
  }).join('\n');

  var schema = [
    '{',
    '  "discussionSummary": string,',
    '  "questions": [ { "question": string, "answer": string, "timestamp": string } ],',
    '  "decisions": [ { "decision": string, "status": "explicit"|"inferred"|"unknown", "evidenceTimestamps": [string] } ],',
    '  "actionItems": [ { "action": string, "owner": string|null, "dueDate": string|null, "dueText": string|null, "status": "explicit"|"inferred"|"unknown", "sourceTimestamp": string } ],',
    '  "unresolvedIssues": [string],',
    '  "confidence": number',
    '}'
  ].join('\n');

  return [
    'คุณเป็นเลขานุการมืออาชีพที่สรุปรายงานการประชุมภาษาไทยเชิงธุรกิจและเป็นทางการ',
    '',
    'บริบท:',
    '- วาระ: ' + (topicMeta.agenda_no || '') + ' ' + (topicMeta.agenda_title || ''),
    '- หัวข้อ: ' + (topicMeta.topic_no || '') + ' ' + (topicMeta.topic_title || ''),
    topicMeta.summary_instruction ? '- คำสั่งสรุปของวาระ: ' + topicMeta.summary_instruction : '',
    topicMeta.note ? '- หมายเหตุจากผู้ใช้: ' + topicMeta.note : '',
    '',
    'กติกาสำคัญ (ต้องปฏิบัติเคร่งครัด):',
    '1. สรุปเฉพาะ transcript ของหัวข้อนี้เท่านั้น ห้ามเพิ่มข้อมูลจากภายนอก',
    '2. ใช้ภาษาไทยเชิงธุรกิจ เป็นทางการ',
    '3. "discussionSummary" ต้องเป็นบทสรุปการอภิปรายที่ครบถ้วนในตัวเอง (ไม่ต้องแยกรายผู้พูด)',
    '4. ระบุ "มติที่ประชุม" (decision) เฉพาะเมื่อมีหลักฐานชัดเจนในบทสนทนา',
    '5. ระบุ action item เฉพาะเมื่อมีการมอบหมายงานจริง',
    '6. ห้ามเดาชื่อผู้รับผิดชอบ (owner) — ถ้าไม่ระบุชัด ให้ใช้ null',
    '7. ห้ามเดากำหนดเวลา (dueDate) — ถ้าไม่มีวันที่ชัดเจนให้ใช้ null และใส่ข้อความกำหนดเวลาไว้ที่ dueText',
    '8. สำหรับแต่ละคำถาม: สรุปใจความให้กระชับ ห้ามคัดลอกประโยคดิบจาก transcript มาวาง —',
    '   field "question" = ระบุชื่อผู้ถาม + ใจความคำถาม (เช่น "คุณธนกร ถามว่า ...")',
    '   field "answer" = ระบุชื่อผู้ตอบ + ใจความคำชี้แจง (เช่น "คุณพิมพ์ชนก ชี้แจงว่า ...") ถ้าไม่มีการชี้แจงให้ใช้ ""',
    '9. หากไม่มีข้อมูลในช่องใด ให้คืนค่า array ว่าง หรือ null ตามชนิดข้อมูล',
    '10. เก็บ timestamp ของหลักฐานสำหรับทุก decision และ action item',
    '11. แยกสถานะ (status) เป็น explicit / inferred / unknown',
    '12. ตอบเป็น JSON ตาม schema นี้เท่านั้น ห้ามมีข้อความอื่นหรือ markdown',
    '',
    'JSON schema:',
    schema,
    '',
    'Transcript ของหัวข้อนี้:',
    transcript || '(ไม่มีเนื้อหา)'
  ].filter(function (x) { return x !== ''; }).join('\n');
}

/** parse JSON ที่ AI คืน (repair: ตัด code fence / หาวงเล็บปีกกา) */
function parseAiJson_(text) {
  var t = String(text || '').trim();
  // ตัด markdown code fence ```json ... ```
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  var direct = safeJsonParse_(t, undefined);
  if (direct !== undefined) return direct;
  // fallback: ตัดจาก { แรก ถึง } สุดท้าย
  var first = t.indexOf('{');
  var last = t.lastIndexOf('}');
  if (first >= 0 && last > first) {
    var sub = t.slice(first, last + 1);
    var parsed = safeJsonParse_(sub, undefined);
    if (parsed !== undefined) return parsed;
  }
  throw new Error('AI คืนค่าที่ไม่ใช่ JSON ที่ถูกต้อง');
}

/** เติม field ที่ขาด + ผูก agenda/topic meta ให้ครบ schema */
function normalizeAiResult_(r, topicMeta) {
  r = r || {};
  return {
    agendaNo: topicMeta.agenda_no || '',
    agendaTitle: topicMeta.agenda_title || '',
    topicNo: topicMeta.topic_no || '',
    topicTitle: topicMeta.topic_title || '',
    discussionSummary: r.discussionSummary || '',
    questions: Array.isArray(r.questions) ? r.questions : [],
    decisions: Array.isArray(r.decisions) ? r.decisions : [],
    actionItems: Array.isArray(r.actionItems) ? r.actionItems : [],
    unresolvedIssues: Array.isArray(r.unresolvedIssues) ? r.unresolvedIssues : [],
    confidence: typeof r.confidence === 'number' ? r.confidence : null
  };
}

/** mock summarizer — สร้างผลลัพธ์ตาม schema จาก rows จริง (deterministic) */
function mockSummarize_(topicMeta, rows) {
  rows = rows || [];
  var speakerCount = {};
  rows.forEach(function (r) { speakerCount[r.speaker || '?'] = true; });
  var numSpeakers = Object.keys(speakerCount).length;
  var first = rows[0], last = rows[rows.length - 1];
  return normalizeAiResult_({
    discussionSummary: '[MOCK] สรุปการอภิปรายหัวข้อ ' + (topicMeta.topic_title || topicMeta.topic_no) +
      ' จากผู้พูด ' + numSpeakers + ' ราย รวม ' + rows.length + ' รายการ',
    questions: [],
    decisions: rows.length ? [{
      decision: '[MOCK] ที่ประชุมรับทราบเนื้อหาของหัวข้อนี้',
      status: 'inferred',
      evidenceTimestamps: first ? [first.timestamp] : []
    }] : [],
    actionItems: [],
    unresolvedIssues: [],
    confidence: rows.length ? 0.5 : 0
  }, topicMeta);
}

// =====================================================================
// AI processing endpoints (client queue เรียกทีละหัวข้อ)
// =====================================================================

/** หา topic row ของ job (throw ถ้าไม่พบ) */
function findTopicRow_(jobId, topicNo) {
  var rows = readWhere_(SHEETS.MEETING_TOPICS, function (t) {
    return t.job_id === jobId && String(t.topic_no) === String(topicNo);
  });
  if (!rows.length) throw new Error('ไม่พบหัวข้อ ' + topicNo);
  return rows[0];
}

function updateTopicRow_(jobId, topicNo, updates) {
  var row = findTopicRow_(jobId, topicNo);
  updates.updated_at = nowIso_();
  updateRowByNumber_(SHEETS.MEETING_TOPICS, row.__row, updates);
}

/** สร้างสรุป AI ของหัวข้อหนึ่ง */
function generateTopicSummary(jobId, topicNo) {
  var user = requireUser_();
  var job = loadOwnedJob_(jobId, user);
  var topicRow = findTopicRow_(jobId, topicNo);
  var topicMeta = {
    agenda_no: topicRow.agenda_no, agenda_title: topicRow.agenda_title,
    topic_no: topicRow.topic_no, topic_title: topicRow.topic_title,
    summary_instruction: topicRow.summary_instruction, note: topicRow.note
  };
  var rows = getTopicTranscriptRows_(job, topicNo);

  updateTopicRow_(jobId, topicNo, { ai_status: AI_STATUS.PROCESSING });
  setJobStatus_(jobId, JOB_STATUS.PROCESSING);
  try {
    var result = geminiSummarizeTopic_(topicMeta, rows);
    updateTopicRow_(jobId, topicNo, {
      ai_status: AI_STATUS.COMPLETED,
      ai_result_json: safeJsonStringify_(result)
    });
    writeAuditLog('AI_SUMMARY', { job_id: jobId, topic: topicNo, rows: rows.length });
    return jsonSafe_({ topic_no: String(topicNo), ai_status: AI_STATUS.COMPLETED, ai_result: result });
  } catch (e) {
    updateTopicRow_(jobId, topicNo, { ai_status: AI_STATUS.FAILED });
    writeAuditLog('AI_SUMMARY_FAILED', { job_id: jobId, topic: topicNo, error: String(e) });
    return { topic_no: String(topicNo), ai_status: AI_STATUS.FAILED, error: errText_(e) };
  }
}

/** regenerate — ล้างผลเดิม + การแก้ของ user + สถานะยืนยัน */
function regenerateTopicSummary(jobId, topicNo) {
  var user = requireUser_();
  loadOwnedJob_(jobId, user);
  updateTopicRow_(jobId, topicNo, {
    user_edited_result_json: '', approved: false, ai_status: AI_STATUS.PENDING
  });
  return generateTopicSummary(jobId, topicNo);
}

/** บันทึกผลที่ผู้ใช้แก้ไข (human review) */
function saveReviewedTopic(jobId, topicNo, reviewedData) {
  var user = requireUser_();
  loadOwnedJob_(jobId, user);
  updateTopicRow_(jobId, topicNo, {
    user_edited_result_json: safeJsonStringify_(reviewedData)
  });
  writeAuditLog('SAVE_REVIEW', { job_id: jobId, topic: topicNo });
  return { ok: true };
}

/** ยืนยัน/ยกเลิกยืนยันหัวข้อ */
function confirmTopic(jobId, topicNo, approved) {
  var user = requireUser_();
  loadOwnedJob_(jobId, user);
  updateTopicRow_(jobId, topicNo, { approved: !!approved });
  // ถ้าทุกหัวข้อยืนยันแล้ว -> ตั้งสถานะ APPROVED
  var topics = getJobTopics_(jobId);
  var allApproved = topics.length && topics.every(function (t) { return t.approved; });
  setJobStatus_(jobId, allApproved ? JOB_STATUS.APPROVED : JOB_STATUS.WAITING_FOR_REVIEW);
  return { ok: true, allApproved: allApproved };
}

function errText_(e) { return e && e.message ? e.message : String(e); }
