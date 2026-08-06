/**
 * AuthService.gs
 * ตรวจสอบตัวตน (Google OAuth native ของ Apps Script) + สิทธิ์ (role จาก sheet USERS)
 *
 * ช่วง dev บน Gmail ส่วนตัว -> ใช้ whitelist email ใน USERS เป็นด่านตรวจ
 * เมื่อขึ้น Workspace ค่อยตั้ง ALLOWED_DOMAIN เพื่อบังคับ domain เพิ่ม
 *
 * ทุก server function ที่เข้าถึงข้อมูล ต้องเรียก requireUser_() ก่อนเสมอ
 */

/** email ของผู้ใช้ที่ล็อกอินอยู่ (จาก Google OAuth) */
function getActiveEmail_() {
  var email = Session.getActiveUser().getEmail();
  if (!email) {
    // บางกรณี (deploy execute-as-me) จะได้จาก effective user
    email = Session.getEffectiveUser().getEmail();
  }
  return normalizeEmail_(email);
}

/**
 * คืนข้อมูลผู้ใช้ปัจจุบัน { email, role, status } หรือ null ถ้าไม่มีสิทธิ์
 * ตรวจ 2 ชั้น: (1) domain (ถ้าตั้ง ALLOWED_DOMAIN) (2) มีใน USERS + status ACTIVE
 */
function getCurrentUser() {
  var email = getActiveEmail_();
  if (!email) return null;

  // ชั้น 1: domain restriction (ปิดได้ช่วง dev; ค่าว่าง/-/none ถือว่าไม่ตั้ง)
  var allowedDomain = getConfig_(PROP_KEYS.ALLOWED_DOMAIN);
  if (!isBlankConfig_(allowedDomain)) {
    var domain = email.split('@')[1] || '';
    if (domain !== allowedDomain.trim().toLowerCase()) {
      return null;
    }
  }

  // ชั้น 2: whitelist ใน USERS
  var userRow = findRow_(SHEETS.USERS, 'user_email', email);

  // auto-seed admin: ถ้า email อยู่ใน ADMIN_EMAILS แต่ยังไม่มีใน sheet -> สร้างให้
  if (!userRow && getSeedAdminEmails_().indexOf(email) !== -1) {
    upsertUser_(email, ROLES.ADMIN, 'ACTIVE');
    userRow = findRow_(SHEETS.USERS, 'user_email', email);
  }

  // DEV_OPEN: กัน lockout ตอน setup — คนแรกที่เข้ามา (ผ่าน domain แล้ว) ได้เป็น ADMIN
  if (!userRow && getBoolConfig_(PROP_KEYS.DEV_OPEN)) {
    upsertUser_(email, ROLES.ADMIN, 'ACTIVE');
    userRow = findRow_(SHEETS.USERS, 'user_email', email);
  }

  if (!userRow) return null;
  if (String(userRow.status).toUpperCase() !== 'ACTIVE') return null;

  return {
    email: email,
    role: String(userRow.role || ROLES.USER).toUpperCase(),
    status: userRow.status
  };
}

/** คืน user ถ้ามีสิทธิ์ ไม่งั้น throw (ใช้เป็นด่านหน้าทุก endpoint) */
function requireUser_() {
  var user = getCurrentUser();
  if (!user) {
    throw new Error('ไม่มีสิทธิ์เข้าใช้งาน: บัญชีของคุณยังไม่ได้รับอนุญาต (ติดต่อผู้ดูแลระบบ)');
  }
  return user;
}

/** คืน user ถ้าเป็น ADMIN ไม่งั้น throw */
function requireAdmin_() {
  var user = requireUser_();
  if (user.role !== ROLES.ADMIN) {
    throw new Error('ต้องเป็น ADMIN เท่านั้นจึงจะทำรายการนี้ได้');
  }
  return user;
}

/** true ถ้า user เป็นเจ้าของ job */
function isJobOwner_(user, jobRow) {
  return jobRow && normalizeEmail_(jobRow.user_email) === user.email;
}

/** เพิ่ม/แก้ผู้ใช้ (upsert ตาม email) */
function upsertUser_(email, role, status) {
  var e = normalizeEmail_(email);
  var existing = findRow_(SHEETS.USERS, 'user_email', e);
  var now = nowIso_();
  if (existing) {
    updateRowByNumber_(SHEETS.USERS, existing.__row, {
      role: role, status: status, updated_at: now
    });
  } else {
    appendRow_(SHEETS.USERS, {
      user_email: e, role: role, status: status,
      created_at: now, updated_at: now
    });
  }
}

// ---- Public API สำหรับ client ----

/** endpoint: ข้อมูล user ปัจจุบัน (สำหรับ UI แสดง role/ควบคุมปุ่ม) */
function apiGetCurrentUser() {
  return getCurrentUser();
}
