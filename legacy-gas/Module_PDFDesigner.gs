/**
 * Module_PDFDesigner.gs
 * ออกแบบและสร้าง PDF จากข้อมูล Ticket / Asset โดยใช้ Google Docs เป็นไฟล์ชั่วคราว
 * Template เก็บรวมเป็น JSON หนึ่งค่าในชีต Settings เพื่อลดการใช้ Script Properties
 */

const PDF_REPORT_TYPES_ = {
  ticket: {
    label: 'รายงาน Ticket / Help Desk', sheet: SHEETS.TICKET,
    columns: [
      ['TicketID', 'เลขที่'], ['Title', 'หัวข้อ'], ['RequesterName', 'ผู้แจ้ง'],
      ['Department', 'หน่วยงาน'], ['Category', 'หมวด'], ['Priority', 'ความสำคัญ'],
      ['Status', 'สถานะ'], ['Assignee', 'ผู้รับผิดชอบ'], ['DueAt', 'ครบกำหนด'],
      ['ResolvedAt', 'วันที่แก้ไข'], ['Rating', 'คะแนน']
    ], dateField: 'Timestamp', statusField: 'Status'
  },
  asset: {
    label: 'รายงานทะเบียนทรัพย์สิน IT', sheet: SHEETS.ASSET,
    columns: [
      ['AssetID', 'รหัส'], ['AssetCode', 'รหัสทรัพย์สิน'], ['AssetName', 'ชื่อทรัพย์สิน'],
      ['AssetType', 'ประเภท'], ['Brand', 'ยี่ห้อ'], ['Model', 'รุ่น'],
      ['SerialNumber', 'Serial Number'], ['OwnerName', 'ผู้ครอบครอง'],
      ['Department', 'หน่วยงาน'], ['Location', 'สถานที่'], ['Status', 'สถานะ'],
      ['WarrantyExpire', 'หมดประกัน'], ['Price', 'ราคา']
    ], dateField: 'Timestamp', statusField: 'Status'
  }
};

function getPdfDesignerData() {
  try {
    requireModule('reports', false);
    const types = Object.keys(PDF_REPORT_TYPES_).map(function (key) {
      const def = PDF_REPORT_TYPES_[key];
      return { key: key, label: def.label, columns: def.columns.map(function (c) { return { key: c[0], label: c[1] }; }) };
    });
    return ok({
      orgName: getConfig_('ORG_NAME', 'กองทุนประกันชีวิต'),
      types: types,
      templates: getPdfTemplates_(),
      defaults: { orientation: 'portrait', color: '#0d6efd', footer: 'เอกสารสร้างจากระบบ ISMS Governance', maxRows: 500 }
    });
  } catch (e) { return fail(e.message); }
}

function savePdfDesignTemplate(form) {
  try {
    const user = requireModule('reports', true);
    const design = normalizePdfDesign_(form);
    const name = sanitizeText(form && form.templateName, 100);
    if (!name) throw new Error('กรุณาระบุชื่อ Template');
    const all = getPdfTemplates_().filter(function (t) { return t.name !== name; });
    all.unshift({ name: name, design: design, updatedAt: fmtDateTime(new Date()), updatedBy: user.email });
    setConfig_('PDF_DESIGN_TEMPLATES_JSON', JSON.stringify(all.slice(0, 20)));
    writeAudit_(user, 'SAVE_PDF_TEMPLATE', 'reports', SHEETS.SETTINGS, name, design.reportType, 'success');
    return ok({ message: 'บันทึก Template แล้ว', templates: all.slice(0, 20) });
  } catch (e) { return fail(e.message); }
}

function previewPdfReport(form) {
  try {
    requireModule('reports', false);
    const design = normalizePdfDesign_(form);
    const data = buildPdfReportData_(design);
    return ok({ design: design, rows: data.rows.slice(0, 20), total: data.rows.length, columns: data.columns });
  } catch (e) { return fail(e.message); }
}

function generateDesignedPdf(form) {
  try {
    const user = requireModule('reports', false);
    const design = normalizePdfDesign_(form);
    const data = buildPdfReportData_(design);
    const now = new Date();
    const safeTitle = design.title.replace(/[\\\/:*?"<>|]/g, '_');
    const doc = DocumentApp.create(safeTitle + '_' + Utilities.formatDate(now, 'Asia/Bangkok', 'yyyyMMdd_HHmmss'));
    const body = doc.getBody();
    body.setMarginTop(36).setMarginBottom(36).setMarginLeft(32).setMarginRight(32);
    if (design.orientation === 'landscape') {
      body.setPageWidth(841.89).setPageHeight(595.28);
    }
    body.appendParagraph(design.orgName).setHeading(DocumentApp.ParagraphHeading.HEADING2)
      .setForegroundColor(design.color).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    body.appendParagraph(design.title).setHeading(DocumentApp.ParagraphHeading.HEADING1)
      .setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    if (design.subtitle) body.appendParagraph(design.subtitle).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    body.appendParagraph('วันที่ออกรายงาน: ' + fmtDateTime(now) + '  |  ผู้ออกรายงาน: ' + (user.name || user.email))
      .setFontSize(9).setForegroundColor('#666666').setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    body.appendHorizontalRule();
    body.appendParagraph('จำนวนข้อมูล ' + data.rows.length + ' รายการ').setBold(true);
    const tableRows = [data.columns.map(function (c) { return c.label; })];
    data.rows.forEach(function (r) {
      tableRows.push(data.columns.map(function (c) { return pdfCellValue_(r[c.key]); }));
    });
    const table = body.appendTable(tableRows);
    table.setBorderColor('#b8c2cc').setBorderWidth(0.5);
    const header = table.getRow(0);
    for (let i = 0; i < header.getNumCells(); i++) {
      header.getCell(i).setBackgroundColor(design.color);
      header.getCell(i).editAsText().setForegroundColor('#ffffff').setBold(true).setFontSize(8);
    }
    for (let r = 1; r < table.getNumRows(); r++) {
      for (let c = 0; c < table.getRow(r).getNumCells(); c++) table.getRow(r).getCell(c).editAsText().setFontSize(8);
    }
    body.appendParagraph('\n' + design.footer).setFontSize(8).setForegroundColor('#777777')
      .setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    doc.saveAndClose();
    const docFile = DriveApp.getFileById(doc.getId());
    const folder = getEvidenceFolder_('รายงาน/PDF Designer');
    const pdf = folder.createFile(docFile.getAs(MimeType.PDF)).setName(doc.getName() + '.pdf');
    docFile.setTrashed(true);
    writeAudit_(user, 'EXPORT_PDF', 'reports', PDF_REPORT_TYPES_[design.reportType].sheet,
      pdf.getId(), design.title + ' (' + data.rows.length + ' rows)', 'success');
    return ok({ url: pdf.getUrl(), name: pdf.getName(), total: data.rows.length });
  } catch (e) { return fail(e.message); }
}

function getPdfTemplates_() {
  try {
    const parsed = JSON.parse(getConfig_('PDF_DESIGN_TEMPLATES_JSON', '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { return []; }
}

function normalizePdfDesign_(form) {
  form = form || {};
  const type = String(form.reportType || 'ticket').toLowerCase();
  const def = PDF_REPORT_TYPES_[type];
  if (!def) throw new Error('ประเภทรายงานไม่ถูกต้อง');
  const allowed = def.columns.map(function (c) { return c[0]; });
  let columns = Array.isArray(form.columns) ? form.columns.filter(function (c) { return allowed.indexOf(String(c)) > -1; }) : [];
  if (!columns.length) columns = allowed.slice(0, Math.min(8, allowed.length));
  let color = String(form.color || '#0d6efd');
  if (!/^#[0-9a-f]{6}$/i.test(color)) color = '#0d6efd';
  return {
    reportType: type,
    orgName: sanitizeText(form.orgName || getConfig_('ORG_NAME', 'กองทุนประกันชีวิต'), 160),
    title: sanitizeText(form.title || def.label, 180), subtitle: sanitizeText(form.subtitle, 220),
    footer: sanitizeText(form.footer || 'เอกสารสร้างจากระบบ ISMS Governance', 240),
    orientation: form.orientation === 'landscape' ? 'landscape' : 'portrait', color: color,
    columns: columns, status: sanitizeText(form.status, 80),
    dateFrom: sanitizeText(form.dateFrom, 20), dateTo: sanitizeText(form.dateTo, 20),
    maxRows: Math.max(1, Math.min(parseInt(form.maxRows, 10) || 500, 1000))
  };
}

function buildPdfReportData_(design) {
  const def = PDF_REPORT_TYPES_[design.reportType];
  let rows = readSheetObjectsEnsured_(def.sheet).filter(function (r) {
    if (design.status && String(r[def.statusField] || '') !== design.status) return false;
    const d = r[def.dateField] ? new Date(r[def.dateField]) : null;
    if (design.dateFrom && d && d < new Date(design.dateFrom + 'T00:00:00')) return false;
    if (design.dateTo && d && d > new Date(design.dateTo + 'T23:59:59')) return false;
    return true;
  }).slice(0, design.maxRows);
  const map = {};
  def.columns.forEach(function (c) { map[c[0]] = c[1]; });
  return { rows: rows, columns: design.columns.map(function (key) { return { key: key, label: map[key] || key }; }) };
}

function pdfCellValue_(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (Object.prototype.toString.call(value) === '[object Date]') return fmtDateTime(value);
  return String(value).substring(0, 500);
}

/** แหล่งข้อมูลกลางสำหรับ Designer ครอบคลุมทุกโมดูลที่ผูกกับชีต */
function getUniversalReportSources() {
  try {
    const user = requireModule('reports', false);
    const sources = [];
    Object.keys(MODULE_TABLE_MAP_).forEach(function (moduleKey) {
      if (!canAccessModule(user.role, moduleKey)) return;
      (MODULE_TABLE_MAP_[moduleKey] || []).forEach(function (sheetName) {
        if (!DB_SCHEMA[sheetName]) return;
        sources.push({ moduleKey: moduleKey, sheet: sheetName,
          label: (MODULE_ACCESS[moduleKey] && MODULE_ACCESS[moduleKey].label || moduleKey) + ' · ' + sheetName,
          fields: DB_SCHEMA[sheetName].filter(function (x) { return STD_COLS.indexOf(x) < 0; }) });
      });
    });
    return ok({ sources: sources });
  } catch (e) { return fail(e.message); }
}

function getUniversalReportSample(moduleKey, sheetName) {
  try {
    const user = requireModule('reports', false);
    moduleKey = sanitizeText(moduleKey, 80); sheetName = sanitizeText(sheetName, 120);
    if (!canAccessModule(user.role, moduleKey) || (MODULE_TABLE_MAP_[moduleKey] || []).indexOf(sheetName) < 0 || !DB_SCHEMA[sheetName]) {
      throw new Error('ไม่มีสิทธิ์ใช้แหล่งข้อมูลนี้');
    }
    let rows = readSheetObjectsEnsured_(sheetName);
    let visibleRequestsById = null;
    if (moduleKey === 'serviceCatalog' && user.role !== ROLES.IT_ADMIN) {
      if (sheetName === SHEETS.SERVICE_CATALOG) {
        rows = rows.filter(function (catalog) {
          return String(catalog.Status || '') === 'ใช้งาน' && svcIsEligible_(catalog, user);
        });
      } else {
        const requestRows = sheetName === SHEETS.SERVICE_REQUEST ? rows :
          readSheetObjectsEnsured_(SHEETS.SERVICE_REQUEST);
        visibleRequestsById = {};
        requestRows.filter(function (request) {
          return svcCanViewRequest_(request, user);
        }).forEach(function (request) {
          visibleRequestsById[String(request.RequestID || '')] = request;
        });

        if (sheetName === SHEETS.SERVICE_REQUEST) {
          rows = rows.filter(function (request) {
            return svcCanViewRequest_(request, user);
          });
        } else if (sheetName === SHEETS.SERVICE_REQUEST_TASK) {
          rows = rows.filter(function (task) {
            return !!visibleRequestsById[String(task.RequestID || '')];
          });
        } else if (sheetName === SHEETS.SERVICE_REQUEST_HISTORY) {
          rows = rows.filter(function (history) {
            const request = visibleRequestsById[String(history.RequestID || '')];
            if (!request) return false;
            const isApprover = String(request.Approver || '').toLowerCase() === String(user.email || '').toLowerCase();
            return isApprover || svcIsYes_(history.IsPublic);
          });
        }
      }
    }
    let row = rows[0] || {};
    if (moduleKey === 'serviceCatalog' && user.role !== ROLES.IT_ADMIN) {
      // Universal Designer keeps every schema key available, but sample values
      // must mirror the least-privilege DTOs used by Service Catalog itself.
      if (sheetName === SHEETS.SERVICE_CATALOG) {
        row = Object.assign({}, row, {
          Eligibility: '', Approver: '', FulfillmentGroup: '', ChecklistJSON: '',
          WorkflowJSON: '', CloseCondition: '', Owner: '', Notes: '', CreatedBy: '',
          LastUpdatedBy: ''
        });
      } else if (sheetName === SHEETS.SERVICE_REQUEST) {
        row = Object.assign({}, row, {
          WorkflowJSON: '', ChecklistSnapshotJSON: '', Notes: '', IdempotencyKey: '',
          CreatedBy: '', LastUpdatedBy: ''
        });
      } else if (sheetName === SHEETS.SERVICE_REQUEST_TASK && row.RequestID) {
        const parent = visibleRequestsById && visibleRequestsById[String(row.RequestID)];
        const isApprover = parent && String(parent.Approver || '').toLowerCase() === String(user.email || '').toLowerCase();
        row = Object.assign({}, row, {
          EvidenceLink: isApprover ? row.EvidenceLink : '',
          Notes: isApprover ? row.Notes : '',
          CreatedBy: '', LastUpdatedBy: ''
        });
      } else if (sheetName === SHEETS.SERVICE_REQUEST_HISTORY) {
        row = Object.assign({}, row, { CreatedBy: '', LastUpdatedBy: '' });
      }
    }
    const sample = {};
    DB_SCHEMA[sheetName].forEach(function (key) { sample[key] = pdfCellValue_(row[key]); });
    return ok({ row: sample });
  } catch (e) { return fail(e.message); }
}

function listCanvasTemplates() {
  try {
    requireModule('reports', false); ensureSheetBySchema_(SHEETS.PDF_DESIGN_TEMPLATE);
    return ok(readSheetObjects_(SHEETS.PDF_DESIGN_TEMPLATE).filter(function (r) { return String(r.Status || 'Active') === 'Active'; })
      .map(function (r) { return { id:r.TemplateID,name:r.TemplateName,orientation:r.Orientation,moduleKey:r.SourceModule,
        sheet:r.SourceSheet,json:loadCanvasTemplateJson_(r.DesignJSON),updatedAt:safeFmtDateTime_(r.LastUpdatedAt || r.Timestamp) }; }).reverse());
  } catch (e) { return fail(e.message); }
}

function saveCanvasTemplate(form) {
  try {
    const user=requireModule('reports',true); form=form||{}; const name=sanitizeText(form.name,120);
    const json=String(form.json||''); if(!name)throw new Error('กรุณาระบุชื่อ Template');
    if(!json || json.length>2000000)throw new Error('Template มีขนาดเกิน 2 MB กรุณาลดขนาดหรือจำนวนรูปภาพ');
    JSON.parse(json); ensureSheetBySchema_(SHEETS.PDF_DESIGN_TEMPLATE);
    let id=sanitizeText(form.id,80), row=id?findRow_(SHEETS.PDF_DESIGN_TEMPLATE,'TemplateID',id):null;
    let storedJson=json;
    if(json.length>45000){
      const file=getEvidenceFolder_('รายงาน/PDF Designer Templates').createFile(Utilities.newBlob(json,'application/json',(id||'new')+'.json'));
      storedJson='drive:'+file.getId();
      if(row && String(row.DesignJSON||'').indexOf('drive:')===0){try{DriveApp.getFileById(String(row.DesignJSON).substring(6)).setTrashed(true);}catch(ignore){}}
    }
    const patch={TemplateName:name,PageSize:'A4',Orientation:form.orientation==='landscape'?'landscape':'portrait',
      SourceModule:sanitizeText(form.moduleKey,80),SourceSheet:sanitizeText(form.sheet,120),DesignJSON:storedJson,Status:'Active'};
    if(row)updateRow_(SHEETS.PDF_DESIGN_TEMPLATE,row._row,patch,user.email); else {id=generateId('PDFTPL');patch.TemplateID=id;appendRow_(SHEETS.PDF_DESIGN_TEMPLATE,patch,user.email);}
    writeAudit_(user,'SAVE_PDF_TEMPLATE','reports',SHEETS.PDF_DESIGN_TEMPLATE,id,name,'success');
    return ok({id:id,message:'บันทึก Template แล้ว'});
  } catch(e){return fail(e.message);}
}

function loadCanvasTemplateJson_(stored) {
  stored=String(stored||'');
  if(stored.indexOf('drive:')!==0)return stored;
  try{return DriveApp.getFileById(stored.substring(6)).getBlob().getDataAsString('UTF-8');}
  catch(e){return '';}
}

function deleteCanvasTemplate(templateId) {
  try { const user=requireModule('reports',true); const row=findRow_(SHEETS.PDF_DESIGN_TEMPLATE,'TemplateID',sanitizeText(templateId,80));
    if(!row)throw new Error('ไม่พบ Template'); updateRow_(SHEETS.PDF_DESIGN_TEMPLATE,row._row,{Status:'Inactive'},user.email);
    writeAudit_(user,'DELETE_PDF_TEMPLATE','reports',SHEETS.PDF_DESIGN_TEMPLATE,templateId,row.TemplateName,'success'); return ok('ปิดใช้งาน Template แล้ว');
  } catch(e){return fail(e.message);}
}

/** รับภาพ A4 จาก Fabric Canvas แล้วบันทึกเป็น PDF; ตัวอักษรไทยคงรูปตาม Canvas */
function generateCanvasPdf(payload) {
  try {
    const user = requireModule('reports', false);
    payload = payload || {};
    const images = Array.isArray(payload.images) && payload.images.length ? payload.images : [payload.imageBase64];
    if (!images[0]) throw new Error('ไม่พบภาพจากหน้าออกแบบ');
    if (images.length > 20) throw new Error('รองรับสูงสุด 20 หน้า ต่อ PDF');
    const title = sanitizeText(payload.title || 'รายงานออกแบบ', 160);
    const doc = DocumentApp.create(title + '_' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd_HHmmss'));
    const body = doc.getBody();
    body.setMarginTop(0).setMarginBottom(0).setMarginLeft(0).setMarginRight(0);
    if (payload.orientation === 'landscape') body.setPageWidth(841.89).setPageHeight(595.28);
    else body.setPageWidth(595.28).setPageHeight(841.89);
    const maxW = payload.orientation === 'landscape' ? 840 : 594;
    images.forEach(function (dataUrl, index) {
      const bytes=Utilities.base64Decode(String(dataUrl).replace(/^data:image\/png;base64,/, ''));
      if(bytes.length>8*1024*1024)throw new Error('หน้าที่ '+(index+1)+' มีขนาดเกิน 8 MB');
      if(index)body.appendPageBreak(); const image=body.appendImage(Utilities.newBlob(bytes,'image/png','design_'+(index+1)+'.png'));
      if(image.getWidth()>maxW)image.setWidth(maxW).setHeight(Math.round(image.getHeight()*maxW/image.getWidth()));
    });
    doc.saveAndClose();
    const tmp = DriveApp.getFileById(doc.getId());
    const pdf = getEvidenceFolder_('รายงาน/PDF Designer').createFile(tmp.getAs(MimeType.PDF)).setName(doc.getName() + '.pdf');
    tmp.setTrashed(true);
    writeAudit_(user, 'EXPORT_CANVAS_PDF', 'reports', '', pdf.getId(), title+' ('+images.length+' หน้า)', 'success');
    return ok({ url: pdf.getUrl(), name: pdf.getName(), pages:images.length });
  } catch (e) { return fail(e.message); }
}
