/**
 * SheetService.gs
 * ชั้นเข้าถึง Google Sheets ระดับล่าง (repository layer)
 *
 * บริการอื่น ๆ เรียกผ่านชั้นนี้เท่านั้น -> เป็นจุดสลับ DB ในอนาคต
 *
 * สำคัญ: อ่าน/เขียน "ตามชื่อคอลัมน์จริงในชีต" (ไม่ยึดลำดับ SHEET_HEADERS)
 * + auto-migrate เพิ่มคอลัมน์ที่ขาดให้อัตโนมัติ -> ทนต่อ schema เก่า/ลำดับต่าง
 */

/** cache ว่า sheet ไหน migrate แล้วในการรันนี้ (แต่ละ request รีเซ็ตเอง) */
var _migratedSheets = {};

/** เปิด spreadsheet ที่ใช้เป็น DB */
function getSpreadsheet_() {
  var id = getConfig_(PROP_KEYS.SPREADSHEET_ID);
  if (id) {
    return SpreadsheetApp.openById(id);
  }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error('ยังไม่ได้ตั้งค่า SPREADSHEET_ID ใน Script Properties');
  }
  return active;
}

/** อ่าน header row จริงของ sheet เป็น array ของ string */
function getActualHeaders_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) { return String(v); });
}

/**
 * ปรับ header ให้ครบตาม SHEET_HEADERS โดยไม่ทำลายของเดิม:
 *  - ถ้า header ว่าง -> เขียนชุดเต็ม
 *  - ถ้ามีอยู่แล้วแต่ขาดบางคอลัมน์ -> เพิ่มต่อท้าย (non-destructive)
 */
function migrateSheetHeaders_(sheet, sheetName) {
  var expected = SHEET_HEADERS[sheetName];
  if (!expected) return;
  var actual = getActualHeaders_(sheet);
  if (!actual.length || !actual[0]) {
    sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
    sheet.setFrozenRows(1);
    return;
  }
  var missing = expected.filter(function (h) { return actual.indexOf(h) === -1; });
  if (missing.length) {
    sheet.getRange(1, actual.length + 1, 1, missing.length).setValues([missing]);
  }
}

/** ดึง sheet ตามชื่อ (สร้างใหม่ถ้าไม่มี + migrate header ครั้งเดียวต่อ request) */
function getSheet_(sheetName) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    var headers = SHEET_HEADERS[sheetName];
    if (headers) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    }
    _migratedSheets[sheetName] = true;
  } else if (!_migratedSheets[sheetName]) {
    migrateSheetHeaders_(sheet, sheetName);
    _migratedSheets[sheetName] = true;
  }
  return sheet;
}

/** อ่านทุกแถวเป็น array ของ object (ยึด header จริงในชีต) */
function readAll_(sheetName) {
  var sheet = getSheet_(sheetName);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var obj = rowToObject_(headers, values[i]);
    obj.__row = i + 1; // เลขแถวจริง (1-based)
    rows.push(obj);
  }
  return rows;
}

/** อ่านแถวที่ match ตาม predicate */
function readWhere_(sheetName, predicate) {
  return readAll_(sheetName).filter(predicate);
}

/** หาแถวแรกที่ค่าในคอลัมน์ = value */
function findRow_(sheetName, column, value) {
  var rows = readWhere_(sheetName, function (r) { return r[column] === value; });
  return rows.length ? rows[0] : null;
}

/** เพิ่มแถวใหม่จาก object (จัดตามชื่อคอลัมน์จริงในชีต) */
function appendRow_(sheetName, obj) {
  var sheet = getSheet_(sheetName);
  var headers = getActualHeaders_(sheet);
  if (!headers.length || !headers[0]) headers = SHEET_HEADERS[sheetName] || [];
  var row = headers.map(function (h) {
    var v = obj[h];
    return v === undefined || v === null ? '' : v;
  });
  sheet.appendRow(row);
  return obj;
}

/** อัปเดตแถว (merge ค่าใหม่ ตามชื่อคอลัมน์จริง) */
function updateRowByNumber_(sheetName, rowNumber, updates) {
  var sheet = getSheet_(sheetName);
  var headers = getActualHeaders_(sheet);
  var width = headers.length;
  if (!width) return;
  var current = sheet.getRange(rowNumber, 1, 1, width).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (updates.hasOwnProperty(headers[i])) {
      var v = updates[headers[i]];
      current[i] = v === undefined || v === null ? '' : v;
    }
  }
  sheet.getRange(rowNumber, 1, 1, width).setValues([current]);
}

/** ลบแถวตามเลขแถวจริง */
function deleteRowByNumber_(sheetName, rowNumber) {
  var sheet = getSheet_(sheetName);
  sheet.deleteRow(rowNumber);
}

/** แปลง header + value array -> object */
function rowToObject_(headers, values) {
  var obj = {};
  for (var i = 0; i < headers.length; i++) {
    obj[String(headers[i])] = values[i];
  }
  return obj;
}

/**
 * สร้าง sheet ทั้งหมด + migrate header (idempotent) เรียกจาก initSpreadsheet()
 */
function ensureAllSheets_() {
  var ss = getSpreadsheet_();
  Object.keys(SHEETS).forEach(function (key) {
    var name = SHEETS[key];
    var sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    migrateSheetHeaders_(sheet, name);
    _migratedSheets[name] = true;
  });
  var def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) {
    ss.deleteSheet(def);
  }
}
