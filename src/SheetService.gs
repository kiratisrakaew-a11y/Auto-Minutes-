/**
 * SheetService.gs
 * ชั้นเข้าถึง Google Sheets ระดับล่าง (repository layer)
 *
 * บริการอื่น ๆ เรียกผ่านชั้นนี้เท่านั้น -> เป็นจุดสลับ DB ในอนาคต
 * (ถ้าอยากเปลี่ยนไป Firestore/SQL แก้แค่ไฟล์นี้)
 *
 * แต่ละแถวถูกแปลงเป็น object โดยใช้ header จาก SHEET_HEADERS
 */

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

/** ดึง sheet ตามชื่อ (สร้างใหม่พร้อม header ถ้ายังไม่มี) */
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
  }
  return sheet;
}

/** อ่านทุกแถวของ sheet เป็น array ของ object (ตาม header) */
function readAll_(sheetName) {
  var sheet = getSheet_(sheetName);
  var range = sheet.getDataRange();
  var values = range.getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var obj = rowToObject_(headers, values[i]);
    obj.__row = i + 1; // เลขแถวจริงใน sheet (1-based) เผื่อ update/delete
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

/** เพิ่มแถวใหม่จาก object (จัดลำดับตาม header) */
function appendRow_(sheetName, obj) {
  var sheet = getSheet_(sheetName);
  var headers = SHEET_HEADERS[sheetName];
  var row = headers.map(function (h) {
    var v = obj[h];
    return v === undefined || v === null ? '' : v;
  });
  sheet.appendRow(row);
  return obj;
}

/**
 * อัปเดตแถวที่ระบุด้วยเลขแถวจริง (obj.__row) โดย merge ค่าใหม่
 * updates เป็น object ของคอลัมน์ที่จะเปลี่ยน
 */
function updateRowByNumber_(sheetName, rowNumber, updates) {
  var sheet = getSheet_(sheetName);
  var headers = SHEET_HEADERS[sheetName];
  var current = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (updates.hasOwnProperty(headers[i])) {
      var v = updates[headers[i]];
      current[i] = v === undefined || v === null ? '' : v;
    }
  }
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([current]);
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
    obj[headers[i]] = values[i];
  }
  return obj;
}

/**
 * สร้าง sheet ทั้งหมดพร้อม header (idempotent)
 * เรียกจาก initSpreadsheet()
 */
function ensureAllSheets_() {
  var ss = getSpreadsheet_();
  Object.keys(SHEETS).forEach(function (key) {
    var name = SHEETS[key];
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
    }
    var headers = SHEET_HEADERS[name];
    // เขียน header ถ้าแถวแรกยังว่าง
    var firstCell = sheet.getRange(1, 1).getValue();
    if (!firstCell && headers) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    }
  });
  // ลบ sheet default 'Sheet1' ถ้าว่างและมี sheet อื่นแล้ว
  var def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) {
    ss.deleteSheet(def);
  }
}
