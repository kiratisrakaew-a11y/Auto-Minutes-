/**
 * Config.gs
 * ศูนย์รวม configuration + constants ของทั้งระบบ
 *
 * หลักการ: ข้อมูลลับ (API key) และ id ต่าง ๆ เก็บใน Script Properties เท่านั้น
 * ห้าม hardcode หรือส่งไปฝั่ง client (ตาม security requirement)
 *
 * ตั้งค่าได้จาก: Apps Script Editor > Project Settings > Script Properties
 * หรือเรียก setupScriptProperties() (ดู SETUP.md)
 */

/** ชื่อ property keys ที่ระบบใช้ */
var PROP_KEYS = {
  SPREADSHEET_ID: 'SPREADSHEET_ID',      // id ของ Google Sheet ที่ใช้เป็น DB (ว่าง = ใช้ active spreadsheet)
  GEMINI_API_KEY: 'GEMINI_API_KEY',      // Gemini API key (ลับ)
  GEMINI_MODEL: 'GEMINI_MODEL',          // ชื่อโมเดล เช่น gemini-2.0-flash
  USE_MOCK_GEMINI: 'USE_MOCK_GEMINI',    // 'true' = ใช้ mock ไม่ยิง API จริง
  DEFAULT_OUTPUT_FOLDER_ID: 'DEFAULT_OUTPUT_FOLDER_ID', // โฟลเดอร์ปลายทาง default (ถ้า job ไม่ระบุ)
  ALLOWED_DOMAIN: 'ALLOWED_DOMAIN',      // ว่าง = ปิด domain restriction (ช่วง dev บน gmail ส่วนตัว)
  ADMIN_EMAILS: 'ADMIN_EMAILS',          // รายชื่อ admin seed คั่นด้วย comma
  RETENTION_DAYS: 'RETENTION_DAYS',      // จำนวนวันเก็บ transcript/ai result (default 1)
  DEV_OPEN: 'DEV_OPEN'                   // 'true' = auto-admit คนแรกเป็น ADMIN (กัน lockout ตอน setup)
};

/** ค่าที่ถือว่า "ไม่ได้ตั้ง" (กันเคสใส่ - หรือ none) */
function isBlankConfig_(v) {
  var s = String(v === null || v === undefined ? '' : v).trim().toLowerCase();
  return s === '' || s === '-' || s === 'none' || s === 'null';
}

/** ค่า default เมื่อไม่ได้ตั้งใน Script Properties */
var CONFIG_DEFAULTS = {
  GEMINI_MODEL: 'gemini-2.0-flash',
  USE_MOCK_GEMINI: 'true',
  RETENTION_DAYS: '1'
};

/** ชื่อ sheet ที่ใช้เป็นตารางใน DB */
var SHEETS = {
  USERS: 'USERS',
  TEMPLATES: 'TEMPLATES',
  TEMPLATE_AGENDAS: 'TEMPLATE_AGENDAS',
  MEETING_JOBS: 'MEETING_JOBS',
  MEETING_TOPICS: 'MEETING_TOPICS',
  AUDIT_LOG: 'AUDIT_LOG'
};

/** header ของแต่ละ sheet (ลำดับคอลัมน์สำคัญ ใช้สร้าง sheet และอ่าน/เขียน) */
var SHEET_HEADERS = {
  USERS: ['user_email', 'role', 'status', 'created_at', 'updated_at'],
  TEMPLATES: ['template_id', 'template_name', 'description', 'google_doc_id',
    'version', 'status', 'created_by', 'created_at', 'updated_at'],
  TEMPLATE_AGENDAS: ['template_id', 'agenda_no', 'agenda_title',
    'summary_instruction', 'sort_order', 'status'],
  MEETING_JOBS: ['job_id', 'user_email', 'template_id', 'meeting_title',
    'meeting_date', 'output_folder_url', 'status', 'meeting_info_json',
    'transcript_json', 'output_document_id', 'expires_at', 'created_at', 'updated_at'],
  MEETING_TOPICS: ['job_id', 'agenda_no', 'agenda_title', 'summary_instruction',
    'topic_no', 'topic_title', 'note',
    'start_time', 'end_time', 'start_seconds', 'end_seconds', 'ai_status',
    'ai_result_json', 'user_edited_result_json', 'approved', 'sort_order', 'updated_at'],
  AUDIT_LOG: ['timestamp', 'user_email', 'action', 'job_id', 'template_id', 'details']
};

/** role ของผู้ใช้ */
var ROLES = { ADMIN: 'ADMIN', USER: 'USER', REVIEWER: 'REVIEWER' };

/** สถานะของ meeting job */
var JOB_STATUS = {
  DRAFT: 'DRAFT',
  TRANSCRIPT_PARSED: 'TRANSCRIPT_PARSED',
  READY_FOR_PROCESSING: 'READY_FOR_PROCESSING',
  PROCESSING: 'PROCESSING',
  WAITING_FOR_REVIEW: 'WAITING_FOR_REVIEW',
  APPROVED: 'APPROVED',
  DOCUMENT_CREATED: 'DOCUMENT_CREATED',
  FAILED: 'FAILED'
};

/** สถานะ AI ของแต่ละหัวข้อ */
var AI_STATUS = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED'
};

/** อ่านค่า config โดยใช้ default fallback */
function getConfig_(key) {
  var props = PropertiesService.getScriptProperties();
  var val = props.getProperty(key);
  if (val === null || val === '') {
    return CONFIG_DEFAULTS[key] !== undefined ? CONFIG_DEFAULTS[key] : '';
  }
  return val;
}

/** true/false flag helper */
function getBoolConfig_(key) {
  return String(getConfig_(key)).toLowerCase() === 'true';
}

/** รายชื่อ admin seed (array ของ email ตัวพิมพ์เล็ก) */
function getSeedAdminEmails_() {
  var raw = getConfig_(PROP_KEYS.ADMIN_EMAILS);
  if (!raw) return [];
  return raw.split(',')
    .map(function (e) { return e.trim().toLowerCase(); })
    .filter(function (e) { return e.length > 0; });
}
