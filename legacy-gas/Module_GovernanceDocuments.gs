/** คลังเอกสารธรรมาภิบาล PDF / Word พร้อม metadata และ AuditTrail */
function listGovernanceDocuments() {
  try {
    requireModule('evidence', false);
    ensureSheetBySchema_(SHEETS.GOVERNANCE_DOCUMENT);
    return ok(readSheetObjects_(SHEETS.GOVERNANCE_DOCUMENT).map(function (r) { return {
      id:r.DocumentID,title:r.Title,type:r.DocumentType,moduleKey:r.ModuleKey,relatedId:r.RelatedID,
      version:r.Version,fileName:r.FileName,mimeType:r.MimeType,url:r.FileURL,reviewDate:safeFmtDate_(r.ReviewDate),
      status:r.Status,notes:r.Notes,createdAt:safeFmtDateTime_(r.Timestamp),createdBy:r.CreatedBy
    }; }).reverse());
  } catch(e) { return fail(e.message); }
}

function registerGovernanceDocument(form) {
  try {
    const user = requireModule('evidence', true); form=form||{};
    const title=sanitizeText(form.title,180), fileName=sanitizeText(form.fileName,180);
    if(!title || !form.fileUrl || !form.fileId) throw new Error('ข้อมูลเอกสารไม่ครบ');
    const ext=fileName.split('.').pop().toLowerCase();
    if(['pdf','doc','docx'].indexOf(ext)<0) throw new Error('รองรับเฉพาะ PDF, DOC และ DOCX');
    ensureSheetBySchema_(SHEETS.GOVERNANCE_DOCUMENT);
    const id=generateId('DOC');
    appendRow_(SHEETS.GOVERNANCE_DOCUMENT,{DocumentID:id,Title:title,DocumentType:sanitizeText(form.documentType,80),
      ModuleKey:sanitizeText(form.moduleKey,80),RelatedID:sanitizeText(form.relatedId,100),Version:sanitizeText(form.version||'1.0',30),
      FileName:fileName,MimeType:sanitizeText(form.mimeType,100),FileURL:sanitizeText(form.fileUrl,500),FileID:sanitizeText(form.fileId,160),
      ReviewDate:form.reviewDate ? new Date(form.reviewDate + 'T00:00:00') : '',Status:'Active',Notes:sanitizeText(form.notes,500)},user.email);
    writeAudit_(user,'REGISTER_DOCUMENT','evidence',SHEETS.GOVERNANCE_DOCUMENT,id,title,'success');
    return ok('บันทึกเอกสารธรรมาภิบาลแล้ว');
  } catch(e) { return fail(e.message); }
}
