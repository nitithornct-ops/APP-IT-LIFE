/**
 * Module_Awareness.gs
 * การสร้างความตระหนักด้านความมั่นคงปลอดภัย (Awareness Training Tracker)
 *  - แผนอบรมประจำปีตามไตรมาส + บันทึกผู้เข้าร่วม + หลักฐาน
 *  - แบบรับทราบนโยบายออนไลน์ (e-sign แบบง่าย: ชื่อ + วันที่ + checkbox)
 * อ้างอิง: หมวด 11
 */

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

function getAwarenessModuleData() {
  try {
    const user = requireModule('awareness', false);
    const isIT = user.role === ROLES.IT_ADMIN;
    // migration ปลอดภัย: เพิ่มคอลัมน์แบบทดสอบถ้ายังไม่มี
    ensureSheetBySchema_(SHEETS.TRAIN_PLAN);
    ensureSheetBySchema_(SHEETS.TRAIN_REC);

    const plans = readSheetObjects_(SHEETS.TRAIN_PLAN).map(function (r) {
      const quiz = parseQuiz_(r.QuizJSON);
      return {
        row: r._row, id: r.PlanID, year: r.Year, quarter: r.Quarter, topic: r.Topic,
        target: r.TargetGroup, plannedDate: fmtDate(r.PlannedDate), plannedDays: daysUntil(r.PlannedDate),
        responsible: r.Responsible, status: r.Status,
        hasQuiz: quiz.length > 0, questionCount: quiz.length,
        passingScore: Number(r.PassingScore) || (quiz.length ? 70 : 0),
        quiz: isIT ? quiz : undefined   // IT เท่านั้นที่เห็นเฉลย (ใช้แก้ไขชุดคำถาม)
      };
    });

    // บันทึกการอบรม: IT เห็นทั้งหมด, ผู้ใช้เห็นของตน
    let records = readSheetObjects_(SHEETS.TRAIN_REC);
    if (!isIT) records = records.filter(function (r) {
      return String(r.AttendeeEmail).toLowerCase() === user.email;
    });
    records = records.map(function (r) {
      return {
        row: r._row, id: r.RecID, planId: r.PlanID, topic: r.Topic, date: fmtDate(r.TrainingDate),
        attendee: r.AttendeeName, attendeeEmail: r.AttendeeEmail, dept: r.Department,
        result: r.Result, score: r.Score, passed: r.Passed, evidence: r.EvidenceLink
      };
    });

    // แบบรับทราบนโยบายของผู้ใช้คนนี้
    const myAcks = readSheetObjects_(SHEETS.POLICY_ACK).filter(function (r) {
      return String(r.AcknowledgerEmail).toLowerCase() === user.email;
    }).map(function (r) {
      return { policy: r.PolicyName, version: r.PolicyVersion, date: fmtDate(r.AckDate) };
    });

    return ok({
      role: user.role, canManage: isIT, quarters: QUARTERS,
      policies: getActivePolicies(), plans: plans, records: records, myAcks: myAcks,
      userName: user.name
    });
  } catch (e) { return fail(e.message); }
}

/** รายชื่อนโยบายให้รับทราบ (ตั้งใน Settings: POLICIES = ชื่อ|เวอร์ชัน;ชื่อ|เวอร์ชัน) */
function getActivePolicies() {
  const raw = getConfig_('POLICIES',
    'นโยบายความมั่นคงปลอดภัยทางสารสนเทศ|ฉบับปรับปรุงปี 2569;' +
    'ประมวลแนวปฏิบัติด้านการรักษาความมั่นคงปลอดภัยไซเบอร์|พ.ศ. 2569');
  return raw.split(';').map(function (p) {
    const parts = p.split('|');
    return { name: (parts[0] || '').trim(), version: (parts[1] || '').trim() };
  }).filter(function (p) { return p.name; });
}

/** เพิ่มแผนอบรม (IT) */
function addTrainingPlan(form) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    form = form || {};
    requireFields({ Topic: form.topic, Year: form.year, Quarter: form.quarter },
      ['Topic', 'Year', 'Quarter']);
    if (!isInList(form.quarter, QUARTERS)) throw new Error('ไตรมาสไม่ถูกต้อง');
    const id = generateId('TRP');
    appendRow_(SHEETS.TRAIN_PLAN, {
      PlanID: id, Year: sanitizeText(form.year, 10), Quarter: form.quarter,
      Topic: sanitizeText(form.topic, 200), TargetGroup: sanitizeText(form.target, 200),
      PlannedDate: parseDate(form.plannedDate), Responsible: sanitizeText(form.responsible, 120) || user.email,
      Status: 'วางแผน', Notes: sanitizeText(form.notes, 500)
    }, user.email);
    writeAudit_(user, 'CREATE', 'awareness', SHEETS.TRAIN_PLAN, id, form.topic, 'success');
    return ok('บันทึกแผนอบรมเรียบร้อย (' + id + ')');
  } catch (e) { return fail(e.message); }
}

function completeTrainingPlan(planId) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    const p = findRow_(SHEETS.TRAIN_PLAN, 'PlanID', planId);
    if (!p) throw new Error('ไม่พบแผนอบรม');
    updateRow_(SHEETS.TRAIN_PLAN, p._row, { Status: 'เสร็จสิ้น' }, user.email);
    writeAudit_(user, 'UPDATE', 'awareness', SHEETS.TRAIN_PLAN, planId, 'เสร็จสิ้น', 'success');
    return ok('อัปเดตสถานะแผนเป็นเสร็จสิ้นเรียบร้อย');
  } catch (e) { return fail(e.message); }
}

/** บันทึกผู้เข้าอบรม (IT) + หลักฐาน */
function addTrainingRecord(form) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    form = form || {};
    const email = String(form.attendeeEmail || '').toLowerCase().trim();
    requireFields({ Topic: form.topic, TrainingDate: form.date, AttendeeEmail: email },
      ['Topic', 'TrainingDate', 'AttendeeEmail']);
    if (!isValidEmail(email)) throw new Error('อีเมลผู้เข้าอบรมไม่ถูกต้อง');
    const u = findRow_(SHEETS.USERS, 'Email', email);
    const id = generateId('TRR');
    appendRow_(SHEETS.TRAIN_REC, {
      RecID: id, PlanID: sanitizeText(form.planId, 40), Topic: sanitizeText(form.topic, 200),
      TrainingDate: parseDate(form.date), AttendeeEmail: email,
      AttendeeName: (u && u.FullName) || sanitizeText(form.attendeeName, 120) || email,
      Department: (u && u.Department) || sanitizeText(form.dept, 120),
      Result: sanitizeText(form.result, 40) || 'ผ่าน', Score: sanitizeText(form.score, 20),
      EvidenceLink: sanitizeText(form.evidence, 500), Notes: sanitizeText(form.notes, 500)
    }, user.email);
    writeAudit_(user, 'CREATE', 'awareness', SHEETS.TRAIN_REC, id, form.topic + ' / ' + email, 'success');
    return ok('บันทึกผู้เข้าอบรมเรียบร้อย (' + id + ')');
  } catch (e) { return fail(e.message); }
}

/** ลงชื่อรับทราบนโยบาย (e-sign แบบง่าย) — ผู้ใช้ทุกคน */
function acknowledgePolicy(policyName, version, signatureName, confirmed) {
  try {
    const user = requireModule('awareness', true);
    if (!confirmed) throw new Error('กรุณาทำเครื่องหมายยืนยันการรับทราบ');
    const sig = sanitizeText(signatureName, 120);
    requireFields({ PolicyName: policyName, SignatureName: sig }, ['PolicyName', 'SignatureName']);

    // กันลงซ้ำเวอร์ชันเดิม
    const dup = readSheetObjects_(SHEETS.POLICY_ACK).some(function (r) {
      return String(r.AcknowledgerEmail).toLowerCase() === user.email &&
        r.PolicyName === policyName && String(r.PolicyVersion) === String(version);
    });
    if (dup) throw new Error('ท่านได้ลงชื่อรับทราบนโยบายฉบับนี้แล้ว');

    const id = generateId('ACK');
    appendRow_(SHEETS.POLICY_ACK, {
      AckID: id, PolicyName: sanitizeText(policyName, 200), PolicyVersion: sanitizeText(version, 60),
      AcknowledgerEmail: user.email, AcknowledgerName: user.name, Department: user.dept,
      AckDate: new Date(), SignatureName: sig, Confirmed: 'Yes', IPHint: ''
    }, user.email);
    writeAudit_(user, 'POLICY_ACK', 'awareness', SHEETS.POLICY_ACK, id, policyName + ' ' + version, 'success');
    return ok('บันทึกการรับทราบนโยบายเรียบร้อย ขอบคุณครับ/ค่ะ');
  } catch (e) { return fail(e.message); }
}

// ===================================================================
// แบบทดสอบหลังอบรม (Quiz) — กำหนดโดย IT, ทำโดยผู้เข้าอบรม, ตรวจอัตโนมัติ
// รูปแบบคำถาม: [{ q: 'คำถาม', choices: ['ก','ข','ค','ง'], answer: 0 }]
// ===================================================================

/** แปลง QuizJSON เป็น array อย่างปลอดภัย (คืน [] ถ้าผิดรูปแบบ) */
function parseQuiz_(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(function (q) {
      return q && typeof q.q === 'string' && Array.isArray(q.choices) && q.choices.length >= 2 &&
        typeof q.answer === 'number' && q.answer >= 0 && q.answer < q.choices.length;
    });
  } catch (e) { return []; }
}

/** IT: บันทึก/แก้ไขชุดคำถามแบบทดสอบของแผนอบรม */
function saveTrainingQuiz(planId, questions, passingScore) {
  try {
    const user = requireRole([ROLES.IT_ADMIN]);
    ensureSheetBySchema_(SHEETS.TRAIN_PLAN);
    const p = findRow_(SHEETS.TRAIN_PLAN, 'PlanID', planId);
    if (!p) throw new Error('ไม่พบแผนอบรม');
    if (!Array.isArray(questions)) throw new Error('รูปแบบคำถามไม่ถูกต้อง');
    if (questions.length > 50) throw new Error('จำกัดไม่เกิน 50 คำถามต่อชุด');

    const clean = questions.map(function (q, i) {
      const text = sanitizeText(q.q, 500);
      const choices = (Array.isArray(q.choices) ? q.choices : []).map(function (c) { return sanitizeText(c, 300); })
        .filter(function (c) { return c !== ''; });
      const answer = parseInt(q.answer, 10);
      if (!text) throw new Error('คำถามข้อที่ ' + (i + 1) + ' ยังไม่มีข้อความ');
      if (choices.length < 2) throw new Error('คำถามข้อที่ ' + (i + 1) + ' ต้องมีตัวเลือกอย่างน้อย 2 ข้อ');
      if (!(answer >= 0 && answer < choices.length)) throw new Error('คำถามข้อที่ ' + (i + 1) + ' ยังไม่ได้เลือกคำตอบที่ถูก');
      return { q: text, choices: choices, answer: answer };
    });

    let pass = parseInt(passingScore, 10);
    if (isNaN(pass) || pass < 0 || pass > 100) pass = 70;

    updateRow_(SHEETS.TRAIN_PLAN, p._row, {
      QuizJSON: clean.length ? JSON.stringify(clean) : '', PassingScore: clean.length ? pass : ''
    }, user.email);
    writeAudit_(user, 'SAVE_QUIZ', 'awareness', SHEETS.TRAIN_PLAN, planId,
      clean.length + ' คำถาม / ผ่าน ' + pass + '%', 'success');
    return ok(clean.length ? ('บันทึกแบบทดสอบ ' + clean.length + ' คำถามเรียบร้อย') : 'ลบแบบทดสอบของแผนนี้แล้ว');
  } catch (e) { return fail(e.message); }
}

/** ผู้เข้าอบรม: ดึงคำถาม (ไม่ส่งเฉลย) เพื่อทำแบบทดสอบ */
function getTrainingQuiz(planId) {
  try {
    requireModule('awareness', true);
    const p = findRow_(SHEETS.TRAIN_PLAN, 'PlanID', planId);
    if (!p) throw new Error('ไม่พบแผนอบรม');
    const quiz = parseQuiz_(p.QuizJSON);
    if (!quiz.length) throw new Error('แผนอบรมนี้ยังไม่มีแบบทดสอบ');
    return ok({
      planId: planId, topic: p.Topic,
      passingScore: Number(p.PassingScore) || 70,
      questions: quiz.map(function (q) { return { q: q.q, choices: q.choices }; }) // ไม่รวมเฉลย
    });
  } catch (e) { return fail(e.message); }
}

/** ผู้เข้าอบรม: ส่งคำตอบ → ตรวจฝั่ง server → บันทึกผลลง TrainingRecords */
function submitTrainingQuiz(planId, answers) {
  try {
    const user = requireModule('awareness', true);
    ensureSheetBySchema_(SHEETS.TRAIN_REC);
    const p = findRow_(SHEETS.TRAIN_PLAN, 'PlanID', planId);
    if (!p) throw new Error('ไม่พบแผนอบรม');
    const quiz = parseQuiz_(p.QuizJSON);
    if (!quiz.length) throw new Error('แผนอบรมนี้ยังไม่มีแบบทดสอบ');
    if (!Array.isArray(answers) || answers.length !== quiz.length)
      throw new Error('กรุณาตอบคำถามให้ครบทุกข้อ');

    let correct = 0;
    const detail = quiz.map(function (q, i) {
      const your = parseInt(answers[i], 10);
      const isCorrect = your === q.answer;
      if (isCorrect) correct++;
      return { correct: isCorrect, your: isNaN(your) ? -1 : your, answer: q.answer };
    });
    const total = quiz.length;
    const score = Math.round((correct / total) * 100);
    const pass = Number(p.PassingScore) || 70;
    const passed = score >= pass;

    const u = findRow_(SHEETS.USERS, 'Email', user.email);
    const id = generateId('TRR');
    appendRow_(SHEETS.TRAIN_REC, {
      RecID: id, PlanID: planId, Topic: p.Topic, TrainingDate: new Date(),
      AttendeeEmail: user.email, AttendeeName: user.name,
      Department: (u && u.Department) || user.dept || '',
      Result: passed ? 'ผ่าน' : 'ไม่ผ่าน', Score: score + '%', Passed: passed ? 'Yes' : 'No',
      Notes: 'แบบทดสอบออนไลน์ ' + correct + '/' + total + ' ข้อ'
    }, user.email);
    writeAudit_(user, 'QUIZ_SUBMIT', 'awareness', SHEETS.TRAIN_REC, id,
      p.Topic + ' = ' + score + '% (' + (passed ? 'ผ่าน' : 'ไม่ผ่าน') + ')', 'success');

    return ok({ score: score, correct: correct, total: total, passingScore: pass, passed: passed, detail: detail });
  } catch (e) { return fail(e.message); }
}
