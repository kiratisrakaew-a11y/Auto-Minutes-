/**
 * MeetingJobService.gs
 * จัดการ Meeting Job (งานสร้างรายงาน 1 ครั้ง) + topics + retention
 *
 * job แก้ได้เฉพาะเจ้าของ (ตรวจทุก endpoint)
 * transcript + ai result เก็บ 1 วัน (RETENTION_DAYS) แล้วถูกล้างโดย cleanupExpiredJobs()
 */

/** จำนวนวันเก็บข้อมูล */
function getRetentionDays_() {
  var d = parseInt(getConfig_(PROP_KEYS.RETENTION_DAYS), 10);
  return isNaN(d) || d < 0 ? 1 : d;
}

/** คำนวณ expires_at (ISO) จากตอนนี้ */
function computeExpiry_() {
  var days = getRetentionDays_();
  var d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

/**
 * สร้าง meeting job ใหม่
 * data = { template_id, meeting_title, meeting_date, output_folder_url,
 *          meeting_info: {location,start_time,end_time,chairman,secretary,participants,ref_no} }
 */
function createMeetingJob(data) {
  var user = requireUser_();
  if (!data || !data.template_id) throw new Error('ต้องเลือก template');
  if (!data.meeting_title) throw new Error('ต้องระบุชื่อการประชุม');
  var tpl = findRow_(SHEETS.TEMPLATES, 'template_id', data.template_id);
  if (!tpl) throw new Error('ไม่พบ template ที่เลือก');

  var id = genId_('job');
  var now = nowIso_();
  appendRow_(SHEETS.MEETING_JOBS, {
    job_id: id,
    user_email: user.email,
    template_id: data.template_id,
    meeting_title: data.meeting_title,
    meeting_date: data.meeting_date || '',
    output_folder_url: data.output_folder_url || '',
    status: JOB_STATUS.DRAFT,
    meeting_info_json: safeJsonStringify_(data.meeting_info || {}),
    transcript_json: '',
    output_document_id: '',
    expires_at: computeExpiry_(),
    created_at: now,
    updated_at: now
  });
  writeAuditLog('CREATE_JOB', { job_id: id, template_id: data.template_id });
  return getMeetingJob(id);
}

/** โหลด job (เจ้าของเท่านั้น) พร้อม meeting_info, transcript, topics */
function getMeetingJob(jobId) {
  var user = requireUser_();
  var job = loadOwnedJob_(jobId, user);
  return jsonSafe_(jobToClient_(job));
}

/** โหลด job row + ตรวจสิทธิ์เจ้าของ (throw ถ้าไม่ใช่) */
function loadOwnedJob_(jobId, user) {
  var job = findRow_(SHEETS.MEETING_JOBS, 'job_id', jobId);
  if (!job) throw new Error('ไม่พบงาน: ' + jobId);
  if (!isJobOwner_(user, job)) throw new Error('คุณไม่มีสิทธิ์เข้าถึงงานนี้ (เฉพาะเจ้าของเท่านั้น)');
  return job;
}

/** แปลง job row -> object สำหรับ client */
function jobToClient_(job) {
  return {
    job_id: job.job_id,
    template_id: job.template_id,
    meeting_title: job.meeting_title,
    meeting_date: job.meeting_date ? String(job.meeting_date) : '',
    output_folder_url: job.output_folder_url,
    status: job.status,
    meeting_info: safeJsonParse_(job.meeting_info_json, {}),
    transcript: safeJsonParse_(job.transcript_json, { rows: [] }),
    output_document_id: job.output_document_id,
    topics: getJobTopics_(job.job_id)
  };
}

/**
 * บันทึก draft: อัปเดต meeting info / transcript / status ตามที่ส่งมา (patch)
 * patch = { meeting_title, meeting_date, output_folder_url, meeting_info, transcript, status }
 */
function saveMeetingDraft(jobId, patch) {
  var user = requireUser_();
  var job = loadOwnedJob_(jobId, user);
  patch = patch || {};
  var updates = { updated_at: nowIso_() };
  if (patch.meeting_title !== undefined) updates.meeting_title = patch.meeting_title;
  if (patch.meeting_date !== undefined) updates.meeting_date = patch.meeting_date;
  if (patch.output_folder_url !== undefined) updates.output_folder_url = patch.output_folder_url;
  if (patch.meeting_info !== undefined) updates.meeting_info_json = safeJsonStringify_(patch.meeting_info);
  if (patch.transcript !== undefined) {
    updates.transcript_json = safeJsonStringify_(patch.transcript);
    updates.expires_at = computeExpiry_(); // รีเซ็ต retention เมื่อมีข้อมูลใหม่
  }
  if (patch.status !== undefined) updates.status = patch.status;
  updateRowByNumber_(SHEETS.MEETING_JOBS, job.__row, updates);
  writeAuditLog('SAVE_DRAFT', { job_id: jobId, fields: Object.keys(patch) });
  return getMeetingJob(jobId);
}

/** อัปเดตสถานะ job (ภายใน) */
function setJobStatus_(jobId, status) {
  var job = findRow_(SHEETS.MEETING_JOBS, 'job_id', jobId);
  if (job) updateRowByNumber_(SHEETS.MEETING_JOBS, job.__row, { status: status, updated_at: nowIso_() });
}

// ---- Topics ----

/** ดึง topics ของ job (เรียงตาม sort_order) */
function getJobTopics_(jobId) {
  return readWhere_(SHEETS.MEETING_TOPICS, function (t) { return t.job_id === jobId; })
    .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); })
    .map(function (t) {
      return {
        agenda_no: String(t.agenda_no),
        agenda_title: t.agenda_title || '',
        summary_instruction: t.summary_instruction || '',
        topic_no: String(t.topic_no),
        topic_title: t.topic_title,
        note: t.note || '',
        start_time: t.start_time,
        end_time: t.end_time,
        start_seconds: t.start_seconds === '' ? null : Number(t.start_seconds),
        end_seconds: t.end_seconds === '' ? null : Number(t.end_seconds),
        ai_status: t.ai_status || AI_STATUS.PENDING,
        ai_result: safeJsonParse_(t.ai_result_json, null),
        user_edited_result: safeJsonParse_(t.user_edited_result_json, null),
        approved: String(t.approved) === 'true' || t.approved === true,
        sort_order: Number(t.sort_order) || 0
      };
    });
}

/**
 * retention cleanup — ล้าง transcript + ai result ของ job ที่หมดอายุ
 * ตั้ง time-driven trigger รายวันให้เรียกฟังก์ชันนี้ (ดู SETUP.md)
 */
function cleanupExpiredJobs() {
  var now = new Date();
  var jobs = readAll_(SHEETS.MEETING_JOBS);
  var cleaned = 0;
  jobs.forEach(function (job) {
    if (!job.expires_at) return;
    var exp = new Date(job.expires_at);
    if (isNaN(exp.getTime()) || exp > now) return;
    // ล้างข้อมูลอ่อนไหวแต่คงแถวไว้เป็นประวัติ
    if (job.transcript_json) {
      updateRowByNumber_(SHEETS.MEETING_JOBS, job.__row, {
        transcript_json: '', updated_at: nowIso_()
      });
      cleaned++;
    }
    // ล้าง ai result ของ topics
    readWhere_(SHEETS.MEETING_TOPICS, function (t) { return t.job_id === job.job_id; })
      .forEach(function (t) {
        if (t.ai_result_json || t.user_edited_result_json) {
          updateRowByNumber_(SHEETS.MEETING_TOPICS, t.__row, {
            ai_result_json: '', user_edited_result_json: '', updated_at: nowIso_()
          });
        }
      });
  });
  if (typeof Logger !== 'undefined') Logger.log('cleanupExpiredJobs: ล้าง transcript ' + cleaned + ' job');
  return { cleaned: cleaned };
}
