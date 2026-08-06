/**
 * TemplateService.gs
 * จัดการ Template รายงานการประชุม (ส่วน metadata + โครงสร้างวาระ)
 *
 * Template แยก 2 ส่วน:
 *  - Document Template  : Google Docs (เก็บ google_doc_id) กำหนดรูปแบบเอกสาร + placeholder
 *  - Agenda Config      : โครงสร้างวาระเริ่มต้น (TEMPLATE_AGENDAS)
 *
 * เฉพาะ ADMIN เท่านั้นที่สร้าง/แก้ template ได้
 */

/** รายการ template ที่ active (สำหรับหน้าเลือก) พร้อมจำนวนวาระ */
function getAvailableTemplates() {
  requireUser_();
  var templates = readWhere_(SHEETS.TEMPLATES, function (t) {
    return String(t.status).toUpperCase() === 'ACTIVE';
  });
  var agendas = readAll_(SHEETS.TEMPLATE_AGENDAS);
  return templates.map(function (t) {
    var count = agendas.filter(function (a) {
      return a.template_id === t.template_id && String(a.status).toUpperCase() !== 'DISABLED';
    }).length;
    return {
      template_id: t.template_id,
      template_name: t.template_name,
      description: t.description,
      version: t.version,
      status: t.status,
      updated_at: t.updated_at ? String(t.updated_at) : '',
      agenda_count: count
    };
  });
}

/** รายละเอียด template รวมรายการวาระ (เรียงตาม sort_order) */
function getTemplateDetails(templateId) {
  requireUser_();
  var t = findRow_(SHEETS.TEMPLATES, 'template_id', templateId);
  if (!t) throw new Error('ไม่พบ template: ' + templateId);
  var agendas = readWhere_(SHEETS.TEMPLATE_AGENDAS, function (a) {
    return a.template_id === templateId && String(a.status).toUpperCase() !== 'DISABLED';
  }).sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); })
    .map(function (a) {
      return {
        agenda_no: String(a.agenda_no),
        agenda_title: a.agenda_title,
        summary_instruction: a.summary_instruction
      };
    });
  return {
    template_id: t.template_id,
    template_name: t.template_name,
    description: t.description,
    google_doc_id: t.google_doc_id,
    version: t.version,
    status: t.status,
    updated_at: t.updated_at ? String(t.updated_at) : '',
    agendas: agendas
  };
}

/**
 * สร้าง template ใหม่ (ADMIN)
 * data = { template_name, description, google_doc_id, agendas: [{agenda_no,agenda_title,summary_instruction}] }
 */
function createTemplate(data) {
  var user = requireAdmin_();
  if (!data || !data.template_name) throw new Error('ต้องระบุชื่อ template');

  var id = genId_('tpl');
  var now = nowIso_();
  appendRow_(SHEETS.TEMPLATES, {
    template_id: id,
    template_name: data.template_name,
    description: data.description || '',
    google_doc_id: extractFolderId_(data.google_doc_id) || data.google_doc_id || '',
    version: '1',
    status: 'ACTIVE',
    created_by: user.email,
    created_at: now,
    updated_at: now
  });
  writeTemplateAgendas_(id, data.agendas || []);
  writeAuditLog('CREATE_TEMPLATE', { template_id: id, name: data.template_name });
  return getTemplateDetails(id);
}

/**
 * แก้ไข template (ADMIN) — เพิ่ม version, เขียนวาระใหม่ทั้งชุด
 */
function updateTemplate(templateId, data) {
  requireAdmin_();
  var t = findRow_(SHEETS.TEMPLATES, 'template_id', templateId);
  if (!t) throw new Error('ไม่พบ template: ' + templateId);
  var newVersion = (parseInt(t.version, 10) || 1) + 1;
  updateRowByNumber_(SHEETS.TEMPLATES, t.__row, {
    template_name: data.template_name || t.template_name,
    description: data.description !== undefined ? data.description : t.description,
    google_doc_id: data.google_doc_id !== undefined
      ? (extractFolderId_(data.google_doc_id) || data.google_doc_id) : t.google_doc_id,
    version: String(newVersion),
    updated_at: nowIso_()
  });
  if (data.agendas) {
    deleteTemplateAgendas_(templateId);
    writeTemplateAgendas_(templateId, data.agendas);
  }
  writeAuditLog('UPDATE_TEMPLATE', { template_id: templateId, version: newVersion });
  return getTemplateDetails(templateId);
}

/** ปิดใช้งาน template (ADMIN) */
function disableTemplate(templateId) {
  requireAdmin_();
  var t = findRow_(SHEETS.TEMPLATES, 'template_id', templateId);
  if (!t) throw new Error('ไม่พบ template: ' + templateId);
  updateRowByNumber_(SHEETS.TEMPLATES, t.__row, { status: 'DISABLED', updated_at: nowIso_() });
  writeAuditLog('DISABLE_TEMPLATE', { template_id: templateId });
  return { ok: true };
}

// ---- helpers ----

function writeTemplateAgendas_(templateId, agendas) {
  agendas.forEach(function (a, i) {
    appendRow_(SHEETS.TEMPLATE_AGENDAS, {
      template_id: templateId,
      agenda_no: String(a.agenda_no || (i + 1)),
      agenda_title: a.agenda_title || '',
      summary_instruction: a.summary_instruction || '',
      sort_order: i + 1,
      status: 'ACTIVE'
    });
  });
}

function deleteTemplateAgendas_(templateId) {
  // ลบจากล่างขึ้นบนเพื่อไม่ให้เลขแถวเลื่อน
  var rows = readWhere_(SHEETS.TEMPLATE_AGENDAS, function (a) {
    return a.template_id === templateId;
  }).sort(function (a, b) { return b.__row - a.__row; });
  rows.forEach(function (r) { deleteRowByNumber_(SHEETS.TEMPLATE_AGENDAS, r.__row); });
}
