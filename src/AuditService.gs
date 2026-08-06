/**
 * AuditService.gs
 * บันทึกกิจกรรมสำคัญลง sheet AUDIT_LOG (ใครทำอะไร เมื่อไร)
 *
 * ไม่ throw ถ้าเขียน log ไม่สำเร็จ เพื่อไม่ให้กระทบ flow หลัก
 */

/**
 * เขียน audit log
 * @param {string} action  ชื่อ action เช่น 'CREATE_JOB'
 * @param {Object} details ข้อมูลเพิ่มเติม (อาจมี job_id, template_id, ...)
 */
function writeAuditLog(action, details) {
  try {
    details = details || {};
    var email = '';
    try { email = getActiveEmail_(); } catch (e) { email = ''; }
    appendRow_(SHEETS.AUDIT_LOG, {
      timestamp: nowIso_(),
      user_email: email,
      action: action,
      job_id: details.job_id || '',
      template_id: details.template_id || '',
      details: safeJsonStringify_(details)
    });
  } catch (e) {
    // เงียบไว้ ไม่ให้ log ล้มทำ flow หลักพัง
    if (typeof Logger !== 'undefined') Logger.log('writeAuditLog error: ' + e);
  }
}
