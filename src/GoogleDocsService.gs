/**
 * GoogleDocsService.gs
 * สร้างรายงานการประชุมเป็น Google Docs
 *
 * ถ้า template มี google_doc_id -> คัดลอกแล้วแทนที่ placeholder {{...}}
 * ถ้าไม่มี -> สร้างเอกสารเปล่าแล้วเขียนเนื้อหาแบบมีโครงสร้าง (fallback)
 *
 * เนื้อหา agenda/action items เป็น "ข้อความ" (ตาม decision — ไม่ทำตาราง)
 * เอกสารถูกตั้งเป็น private (ไม่แชร์สาธารณะ)
 */

/** placeholder ที่รองรับใน document template */
// {{MEETING_TITLE}} {{MEETING_DATE}} {{MEETING_TIME}} {{MEETING_LOCATION}}
// {{CHAIRMAN}} {{SECRETARY}} {{PARTICIPANTS}} {{MEETING_REF}}
// {{AGENDA_CONTENT}} {{ACTION_ITEMS}}

/** สร้างเอกสารการประชุมจาก job (ต้องยืนยันครบทุกหัวข้อ) */
function generateMeetingDocument(jobId) {
  var user = requireUser_();
  var job = loadOwnedJob_(jobId, user);
  var topics = getJobTopics_(jobId);
  if (!topics.length) throw new Error('ยังไม่มีหัวข้อในงานนี้');
  var notApproved = topics.filter(function (t) { return !t.approved; });
  if (notApproved.length) {
    throw new Error('ต้องยืนยัน (human review) ทุกหัวข้อก่อนสร้างเอกสาร — เหลือ ' + notApproved.length + ' หัวข้อ');
  }

  var tpl = findRow_(SHEETS.TEMPLATES, 'template_id', job.template_id);
  var info = safeJsonParse_(job.meeting_info_json, {});
  var folder = resolveOutputFolder_(job.output_folder_url);
  var docName = (job.meeting_title || 'รายงานการประชุม') + ' — ' + (job.meeting_date || nowIso_().slice(0, 10));

  var placeholders = buildPlaceholders_(job, info, topics);

  var doc, fileId;
  if (tpl && tpl.google_doc_id) {
    var copy = DriveApp.getFileById(tpl.google_doc_id).makeCopy(docName, folder);
    fileId = copy.getId();
    doc = DocumentApp.openById(fileId);
    applyPlaceholders_(doc, placeholders);
  } else {
    doc = DocumentApp.create(docName);
    fileId = doc.getId();
    if (folder) moveFileToFolder_(fileId, folder);
    buildMinutesDoc_(doc, job, info, topics);
  }
  doc.saveAndClose();

  // ความปลอดภัย: ไม่แชร์สาธารณะ
  try {
    DriveApp.getFileById(fileId).setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  } catch (e) { /* ถ้าตั้งไม่ได้ ก็ยังคงเป็นของเจ้าของโดย default */ }

  var url = 'https://docs.google.com/document/d/' + fileId + '/edit';
  setJobStatus_(jobId, JOB_STATUS.DOCUMENT_CREATED);
  var jrow = findRow_(SHEETS.MEETING_JOBS, 'job_id', jobId);
  updateRowByNumber_(SHEETS.MEETING_JOBS, jrow.__row, { output_document_id: fileId, updated_at: nowIso_() });
  writeAuditLog('GENERATE_DOC', { job_id: jobId, template_id: job.template_id, document_id: fileId });

  return { document_id: fileId, url: url };
}

/** คืน url เอกสารที่สร้างแล้ว (ถ้ามี) */
function getGeneratedDocumentUrl(jobId) {
  var user = requireUser_();
  var job = loadOwnedJob_(jobId, user);
  if (!job.output_document_id) return { url: '' };
  return { document_id: job.output_document_id,
    url: 'https://docs.google.com/document/d/' + job.output_document_id + '/edit' };
}

// ---- content builders ----

function buildPlaceholders_(job, info, topics) {
  info = info || {};
  var timeStr = '';
  if (info.start_time || info.end_time) {
    timeStr = (info.start_time || '') + (info.end_time ? ' - ' + info.end_time : '');
  }
  return {
    MEETING_TITLE: job.meeting_title || '',
    MEETING_DATE: job.meeting_date ? String(job.meeting_date) : '',
    MEETING_TIME: timeStr,
    MEETING_LOCATION: info.location || '',
    CHAIRMAN: info.chairman || '',
    SECRETARY: info.secretary || '',
    PARTICIPANTS: info.participants || '',
    MEETING_REF: info.ref_no || '',
    AGENDA_CONTENT: buildAgendaContent_(topics),
    ACTION_ITEMS: buildActionItems_(topics)
  };
}

/** ใช้ผลที่ผู้ใช้แก้ ถ้าไม่มีใช้ผล AI */
function effectiveResult_(topic) {
  return topic.user_edited_result || topic.ai_result || null;
}

/** สร้างเนื้อหาวาระ/หัวข้อเป็นข้อความ (จัดกลุ่มตามวาระ) */
function buildAgendaContent_(topics) {
  var lines = [];
  var lastAgenda = null;
  topics.forEach(function (t) {
    if (t.agenda_no !== lastAgenda) {
      lastAgenda = t.agenda_no;
      lines.push('วาระที่ ' + t.agenda_no + ' ' + (t.agenda_title || ''));
    }
    lines.push('   ' + t.topic_no + ' ' + (t.topic_title || ''));
    var r = effectiveResult_(t);
    if (!r) { lines.push('      (ยังไม่มีสรุป)'); lines.push(''); return; }
    if (r.discussionSummary) lines.push('      ' + r.discussionSummary);
    (r.speakerSummaries || []).forEach(function (s) {
      (s.keyPoints || []).forEach(function (kp) {
        lines.push('      - (' + s.speaker + ') ' + kp);
      });
    });
    if ((r.questions || []).length) {
      lines.push('      คำถาม:');
      r.questions.forEach(function (q) {
        lines.push('        • ' + (q.question || '') + (q.speaker ? ' [' + q.speaker + ']' : ''));
      });
    }
    if ((r.decisions || []).length) {
      lines.push('      มติ:');
      r.decisions.forEach(function (d) {
        lines.push('        • ' + (d.decision || '') + (d.status ? ' (' + d.status + ')' : ''));
      });
    }
    lines.push('');
  });
  return lines.join('\n').trim();
}

/** รวม action items ทุกหัวข้อเป็นข้อความ */
function buildActionItems_(topics) {
  var lines = [];
  var n = 0;
  topics.forEach(function (t) {
    var r = effectiveResult_(t);
    if (!r) return;
    (r.actionItems || []).forEach(function (a) {
      n++;
      var parts = [String(n) + '. ' + (a.action || '')];
      if (a.owner) parts.push('ผู้รับผิดชอบ: ' + a.owner);
      if (a.dueText || a.dueDate) parts.push('กำหนด: ' + (a.dueText || a.dueDate));
      if (a.sourceTimestamp) parts.push('อ้างอิง: ' + a.sourceTimestamp);
      lines.push(parts.join('  |  '));
    });
  });
  return lines.length ? lines.join('\n') : '- ไม่มี Action Item -';
}

// ---- doc helpers ----

/** แทนที่ placeholder ทุกตัวใน body/header/footer */
function applyPlaceholders_(doc, map) {
  var containers = [doc.getBody()];
  var header = doc.getHeader(); if (header) containers.push(header);
  var footer = doc.getFooter(); if (footer) containers.push(footer);
  Object.keys(map).forEach(function (key) {
    var pattern = '\\{\\{' + key + '\\}\\}';
    var value = map[key] === null || map[key] === undefined ? '' : String(map[key]);
    containers.forEach(function (c) {
      try { c.replaceText(pattern, value); } catch (e) { /* ignore */ }
    });
  });
}

/**
 * สร้างเอกสารรายงานการประชุมแบบทางการ (Plan B style) ด้วย DocumentApp
 * ดึงวาระ/หัวข้อ + สรุป AI (effectiveResult_) มาเรียงตามรูปแบบมาตรฐาน
 */
function buildMinutesDoc_(doc, job, info, topics) {
  info = info || {};
  var body = doc.getBody();
  body.clear();
  try { body.setText(''); } catch (e) { /* ignore */ }

  var CENTER = DocumentApp.HorizontalAlignment.CENTER;

  // ---- ส่วนหัว ----
  para_(body, job.meeting_title || 'รายงานการประชุม', { bold: true, align: CENTER, size: 16 });
  var when = [];
  if (job.meeting_date) when.push('ประชุมเมื่อวันที่ ' + job.meeting_date);
  var timeStr = (info.start_time || '') + (info.end_time ? ' - ' + info.end_time : '');
  if (timeStr) when.push('เวลา ' + timeStr + ' น.');
  if (info.location) when.push('ณ ' + info.location);
  if (when.length) para_(body, when.join(' '), { align: CENTER });
  if (info.ref_no) para_(body, 'เลขที่อ้างอิง: ' + info.ref_no, { align: CENTER });
  para_(body, '', {});

  // ---- ผู้เข้าร่วม ----
  if (info.chairman) para_(body, 'ประธานที่ประชุม: ' + info.chairman, {});
  if (info.secretary) para_(body, 'เลขานุการ: ' + info.secretary, {});
  if (info.participants) {
    para_(body, 'ผู้เข้าร่วมประชุม:', { bold: true });
    splitList_(info.participants).forEach(function (p, i) { para_(body, (i + 1) + '. ' + p, {}); });
  }
  para_(body, '', {});

  // ---- เปิดประชุม ----
  var chair = info.chairman || 'ประธานฯ';
  para_(body, chair + ' ทำหน้าที่เป็นประธานในที่ประชุม กล่าวเปิดการประชุม และดำเนินการประชุมตามระเบียบวาระดังต่อไปนี้', {});
  para_(body, '', {});

  // ---- วาระ / หัวข้อ ----
  var lastAgenda = null;
  topics.forEach(function (t) {
    if (t.agenda_no !== lastAgenda) {
      lastAgenda = t.agenda_no;
      para_(body, 'วาระที่ ' + t.agenda_no + ' ' + (t.agenda_title || ''), { bold: true, size: 13 });
    }
    para_(body, t.topic_no + ' ' + (t.topic_title || ''), { bold: true });

    var r = effectiveResult_(t);
    if (!r) { para_(body, '(ยังไม่มีสรุป)', {}); para_(body, '', {}); return; }

    if (r.discussionSummary) para_(body, r.discussionSummary, {});
    (r.speakerSummaries || []).forEach(function (s) {
      (s.keyPoints || []).forEach(function (kp) {
        if (kp) para_(body, '- (' + (s.speaker || '') + ') ' + kp, {});
      });
    });
    (r.questions || []).forEach(function (q) {
      if (q.question) para_(body, (q.speaker ? q.speaker + ' สอบถามว่า ' : 'คำถาม: ') + q.question, {});
    });
    // มติที่ประชุม
    var decisions = (r.decisions || []).map(function (d) { return d.decision; }).filter(function (x) { return x; });
    if (decisions.length) {
      para_(body, 'มติที่ประชุม ' + decisions.join(' และ '), { bold: true });
    }
    para_(body, '', {});
  });

  // ---- Action Items ----
  var actionText = buildActionItems_(topics);
  para_(body, 'สรุป Action Items', { bold: true, size: 13 });
  (actionText || '').split('\n').forEach(function (line) { if (line) para_(body, line, {}); });
  para_(body, '', {});
  para_(body, '', {});

  // ---- ลงชื่อ ----
  para_(body, 'ลงชื่อ ____________________________ ประธานที่ประชุม', { align: CENTER });
  para_(body, '(' + (info.chairman || '') + ')', { align: CENTER });
  para_(body, '', {});
  para_(body, 'ลงชื่อ ____________________________ เลขานุการ / ผู้บันทึกรายงานการประชุม', { align: CENTER });
  para_(body, '(' + (info.secretary || '') + ')', { align: CENTER });
}

/** เพิ่มย่อหน้าอย่างปลอดภัย (ข้อความว่าง = ย่อหน้าว่าง; ตั้ง bold/align/size ได้) */
function para_(body, text, opts) {
  opts = opts || {};
  var p = body.appendParagraph(text === null || text === undefined ? '' : String(text));
  if (opts.align) p.setAlignment(opts.align);
  if (String(text || '') !== '') {
    if (opts.bold) p.setBold(true);
    if (opts.size) p.setFontSize(opts.size);
  }
  return p;
}

/** แยกรายชื่อ/รายการจากข้อความ (ขึ้นบรรทัดใหม่ หรือคั่นด้วยจุลภาค) */
function splitList_(text) {
  return String(text || '').split(/[\n,]/).map(function (x) { return x.trim(); })
    .filter(function (x) { return x; });
}

/** เขียนเอกสาร fallback (ไม่มี template) แบบมีโครงสร้าง — คงไว้เผื่อใช้ */
function writeFallbackDoc_(doc, m) {
  var body = doc.getBody();
  body.clear();
  body.appendParagraph(m.MEETING_TITLE || 'รายงานการประชุม').setHeading(DocumentApp.ParagraphHeading.TITLE);
  var meta = [
    ['วันที่', m.MEETING_DATE], ['เวลา', m.MEETING_TIME], ['สถานที่', m.MEETING_LOCATION],
    ['เลขที่อ้างอิง', m.MEETING_REF], ['ประธาน', m.CHAIRMAN], ['เลขานุการ', m.SECRETARY],
    ['ผู้เข้าร่วม', m.PARTICIPANTS]
  ];
  meta.forEach(function (kv) {
    if (kv[1]) body.appendParagraph(kv[0] + ': ' + kv[1]);
  });
  body.appendParagraph('');  // บรรทัดว่างคั่น (appendParagraph('') ปลอดภัย; appendText('') ต่างหากที่ throw)
  body.appendParagraph('วาระการประชุม').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  (m.AGENDA_CONTENT || '').split('\n').forEach(function (line) { body.appendParagraph(line); });
  body.appendParagraph('Action Items').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  (m.ACTION_ITEMS || '').split('\n').forEach(function (line) { body.appendParagraph(line); });
}

/** แก้ folder ปลายทางจาก url หรือ default (null = root) */
function resolveOutputFolder_(folderUrl) {
  var id = extractFolderId_(folderUrl) || getConfig_(PROP_KEYS.DEFAULT_OUTPUT_FOLDER_ID);
  if (!id) return null;
  try { return DriveApp.getFolderById(id); } catch (e) { return null; }
}

/** ย้ายไฟล์ไปโฟลเดอร์ (Drive) */
function moveFileToFolder_(fileId, folder) {
  if (!folder) return;
  var file = DriveApp.getFileById(fileId);
  folder.addFile(file);
  DriveApp.getRootFolder().removeFile(file);
}
