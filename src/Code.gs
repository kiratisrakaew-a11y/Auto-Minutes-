/**
 * Code.gs
 * จุดเข้าหลักของ Web App + ฟังก์ชันตั้งค่าเริ่มต้น (setup)
 *
 * หน้าเว็บเป็น Single Page Application: ทุกหน้าอยู่ใน index.html
 * แล้ว include partial (styles + แต่ละ page + app.js) เข้าไป
 */

/** จุดเข้า Web App */
function doGet(e) {
  var template = HtmlService.createTemplateFromFile('index');
  return template.evaluate()
    .setTitle('Auto Minute — สร้างรายงานการประชุมอัตโนมัติ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** ใช้ใน index.html: <?!= include('styles') ?> เพื่อรวมไฟล์ partial */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * bootstrap: ข้อมูลชุดแรกที่หน้าเว็บต้องใช้ตอนโหลด
 * (user + รายการ template) เพื่อลดจำนวน round-trip
 */
function apiBootstrap() {
  var user = getCurrentUser();
  if (!user) {
    var detected = '';
    try { detected = getActiveEmail_(); } catch (e) { detected = ''; }
    return { authorized: false, user: null, email: detected, templates: [] };
  }
  return {
    authorized: true,
    user: user,
    templates: getAvailableTemplates(),
    settings: {
      mock: getBoolConfig_(PROP_KEYS.USE_MOCK_GEMINI),
      model: getConfig_(PROP_KEYS.GEMINI_MODEL) || CONFIG_DEFAULTS.GEMINI_MODEL,
      retentionDays: getRetentionDays_()
    }
  };
}

// =====================================================================
// SETUP FUNCTIONS — รันครั้งเดียวจาก Editor ตอนติดตั้ง (ดู SETUP.md)
// =====================================================================

/**
 * ตั้งค่า Script Properties แบบ programmatic (ทางเลือกแทนการกรอกมือ)
 * แก้ค่าในนี้แล้วรัน 1 ครั้ง จากนั้นลบค่า sensitive ออกได้
 */
function setupScriptProperties() {
  var props = PropertiesService.getScriptProperties();
  props.setProperties({
    // 'SPREADSHEET_ID': 'วาง id ของ google sheet ที่นี่',
    // 'GEMINI_API_KEY': 'วาง gemini api key ที่นี่',
    'GEMINI_MODEL': 'gemini-2.0-flash',
    'USE_MOCK_GEMINI': 'true',
    // 'ADMIN_EMAILS': 'your-email@gmail.com',
    'ALLOWED_DOMAIN': '',
    'RETENTION_DAYS': '1'
  }, false);
  Logger.log('ตั้งค่า Script Properties เรียบร้อย (ยกเว้นค่าที่ comment ไว้ ให้กรอกเองใน Project Settings)');
}

/**
 * สร้าง sheet ทั้งหมด + seed admin คนแรก
 * ต้องตั้ง SPREADSHEET_ID และ ADMIN_EMAILS ก่อนรัน
 */
function initSpreadsheet() {
  ensureAllSheets_();
  var admins = getSeedAdminEmails_();
  admins.forEach(function (email) {
    upsertUser_(email, ROLES.ADMIN, 'ACTIVE');
  });
  Logger.log('สร้าง sheet ครบแล้ว. seed admin: ' + (admins.length ? admins.join(', ') : '(ไม่มี — ตั้ง ADMIN_EMAILS ก่อน)'));
  return { sheets: Object.keys(SHEETS), admins: admins };
}

/**
 * seed template ตัวอย่าง 1 อัน เพื่อทดสอบ flow ได้เร็ว
 * (ต้องมี Google Docs template จริง + วาง doc id; ถ้าไม่ใส่ generate จะข้าม docs)
 */
function seedSampleTemplate() {
  requireAdmin_();
  var tpl = createTemplate({
    template_name: 'Risk Management Committee Meeting',
    description: 'รายงานการประชุมคณะกรรมการบริหารความเสี่ยง (ตัวอย่าง)',
    google_doc_id: '',
    agendas: [
      { agenda_no: '1', agenda_title: 'รับรองรายงานการประชุมครั้งก่อน', summary_instruction: 'สรุปการแก้ไขและมติรับรอง' },
      { agenda_no: '2', agenda_title: 'เรื่องเพื่อทราบ', summary_instruction: 'สรุปข้อมูลที่นำเสนอและคำถามสำคัญ' },
      { agenda_no: '3', agenda_title: 'เรื่องเพื่อพิจารณา', summary_instruction: 'สรุปทางเลือก ความเห็น และมติ' },
      { agenda_no: '4', agenda_title: 'เรื่องอื่น ๆ', summary_instruction: 'สรุปประเด็นเพิ่มเติม' }
    ]
  });
  Logger.log('สร้าง template ตัวอย่าง: ' + tpl.template_id);
  return tpl;
}
