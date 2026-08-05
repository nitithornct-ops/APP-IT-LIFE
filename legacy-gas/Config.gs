/**
 * Config.gs
 * ศูนย์รวมค่าคงที่ของระบบ: บทบาท (Roles), นิยามโครงสร้างฐานข้อมูล (DB Schema),
 * และเมทริกซ์สิทธิ์การเข้าถึงโมดูล (Module Access Matrix)
 *
 * หมายเหตุด้านความปลอดภัย: ค่าลับ/LINE connection เก็บใน Script Properties
 * ส่วนค่าทั่วไป เช่น SLA, retention, โดเมนอีเมล เก็บในชีต Settings ผ่าน Utils.gs > getConfig_()
 */

// ===== บทบาทผู้ใช้งาน (Roles) =====
const ROLES = {
  USER: 'User',           // ผู้ใช้งานทั่วไป
  APPROVER: 'Approver',   // หัวหน้างาน/ผู้บังคับบัญชา
  IT_ADMIN: 'ITAdmin',    // ส่วนงานเทคโนโลยีและสารสนเทศ
  EXECUTIVE: 'Executive', // ผู้จัดการกองทุนฯ/ผู้บริหาร
  DPO: 'DPO'              // ผู้รับผิดชอบข้อมูลส่วนบุคคล
};

const ROLE_LABELS = {
  User: 'ผู้ใช้งานทั่วไป',
  Approver: 'หัวหน้างาน/ผู้บังคับบัญชา',
  ITAdmin: 'ส่วนงานเทคโนโลยีและสารสนเทศ',
  Executive: 'ผู้จัดการกองทุนฯ/ผู้บริหาร',
  DPO: 'ผู้รับผิดชอบข้อมูลส่วนบุคคล (DPO)'
};

// ===== ชื่อ Sheet (คงที่) =====
const SHEETS = {
  USERS: 'Users',
  EMPLOYEES: 'Employees',
  EMPLOYEE_ASSIGNMENTS: 'EmployeeAssignments',
  LINE_USERS: 'LineUsers',
  LINE_SESSIONS: 'LineSessions',
  AUDIT_TRAIL: 'AuditTrail',
  PERSONAL_TASK: 'PersonalTasks',
  TASK_SUBTASK: 'TaskSubtasks',
  TASK_PROGRESS: 'TaskProgressLogs',
  TASK_LINK: 'TaskLinks',
  TASK_ATTACHMENT: 'TaskAttachments',
  TASK_REMINDER: 'TaskReminders',
  TICKET: 'Tickets',
  TICKET_CATEGORY: 'TicketCategories',
  TICKET_WORKLOG: 'Ticket_Worklogs',
  KB: 'KnowledgeBase',
  ASSET: 'AssetRegister',
  ASSET_CATEGORY: 'AssetCategories',
  ASSET_MOVEMENT: 'Asset_History',
  MAINTENANCE: 'MaintenancePlans',
  PM_TEMPLATE: 'PMChecklistTemplates',
  PM_SCHEDULE: 'PMSchedules',
  PM_WORK_ORDER: 'PMWorkOrders',
  PM_CHECK_RESULT: 'PMChecklistResults',
  PM_FINDING: 'PMFindings',
  PM_STATUS_HISTORY: 'PMStatusHistory',
  INVENTORY: 'Inventory',
  INVENTORY_TX: 'InventoryTransactions',
  SOFTWARE_LICENSE: 'SoftwareLicenses',
  DATA_CLASS: 'DataClassification',
  DATA_DESTROY: 'DataDestructionRequests',
  PRIVACY_ROPA: 'PrivacyROPA',
  PRIVACY_CONSENT: 'PrivacyConsents',
  PRIVACY_DSR: 'PrivacyDSR',
  PROBLEM: 'Problems',
  KNOWN_ERROR: 'KnownErrors',
  VULNERABILITY: 'VulnerabilityFindings',
  AUDIT_ENGAGEMENT: 'AuditEngagements',
  AUDIT_FINDING: 'AuditFindings',
  CONFIG_ITEM: 'ConfigurationItems',
  CI_RELATIONSHIP: 'CIRelationships',
  SERVICE_CATALOG: 'ServiceCatalog',
  SERVICE_REQUEST: 'ServiceRequests',
  SERVICE_REQUEST_TASK: 'ServiceRequestTasks',
  SERVICE_REQUEST_HISTORY: 'ServiceRequestHistory',
  WORKFLOW_DEFINITION: 'WorkflowDefinitions',
  WORKFLOW_STEP: 'WorkflowSteps',
  WORKFLOW_INSTANCE: 'WorkflowInstances',
  WORKFLOW_APPROVAL: 'WorkflowApprovals',
  WORKFLOW_HISTORY: 'WorkflowHistory',
  WORKFLOW_DELEGATION: 'WorkflowDelegations',
  ATTACHMENT_REGISTRY: 'AttachmentRegistry',
  ATTACHMENT_LINK: 'AttachmentLinks',
  ATTACHMENT_ACCESS_LOG: 'AttachmentAccessLog',
  RECORD_LINK: 'RecordLinks',
  INTEGRATION_OUTBOX: 'IntegrationOutbox',
  ACTION_PERMISSION: 'ActionPermissions',
  ROLE_ACTION_PERMISSION: 'RoleActionPermissions',
  USER_PERMISSION_OVERRIDE: 'UserPermissionOverrides',
  APPROVAL_GROUP: 'ApprovalGroups',
  APPROVAL_GROUP_MEMBER: 'ApprovalGroupMembers',
  ACCESS_REQ: 'AccessRequests',
  ACCESS_REGISTRY: 'UserAccessRegistry',
  CHANGE: 'ChangeRequests',
  BACKUP: 'BackupLog',
  RECOVERY: 'RecoveryTests',
  BCP: 'BCPPlans',
  LOG_REGISTER: 'LoggingRegister',
  LOG_REVIEW: 'LogReviews',
  INCIDENT: 'Incidents',
  REGULATORY_NOTIFICATION: 'RegulatoryNotifications',
  RISK: 'RiskRegister',
  LEGAL_REGISTER: 'LegalRegister',
  COMPLIANCE_OBLIGATION: 'ComplianceObligations',
  COMPLIANCE_ASSESSMENT: 'ComplianceAssessments',
  CORRECTIVE_ACTION: 'CorrectiveActions',
  VENDOR: 'VendorRegister',
  AI: 'AIRegister',
  CLOUD: 'CloudRegister',
  TRAIN_PLAN: 'TrainingPlans',
  TRAIN_REC: 'TrainingRecords',
  POLICY_ACK: 'PolicyAcknowledgements',
  NOTIFY_LOG: 'NotificationLog',
  NOTIFY_QUEUE: 'NotificationQueue',
  RETENTION_LOG: 'RetentionLog',
  RATE_LIMIT: 'RateLimits',
  EMPLOYEE_LIFECYCLE: 'EmployeeLifecycle',
  SETTINGS: 'Settings',
  FIELD_DEFINITIONS: 'FieldDefinitions',
  QA_TEST: 'QATestCases',
  POLICY_MAP: 'PolicyMapping'
  ,GOVERNANCE_DOCUMENT: 'GovernanceDocuments'
  ,PDF_DESIGN_TEMPLATE: 'PDFDesignTemplates'
};

// คอลัมน์มาตรฐานที่ทุก Sheet (ยกเว้น AuditTrail) ต้องมีท้ายตาราง
const STD_COLS = ['Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'];

/**
 * นิยามโครงสร้างฐานข้อมูลทั้งหมด (Single Source of Truth)
 * ใช้โดย Setup.gs ในการสร้าง Sheet และเป็นเอกสาร Schema ในตัว
 * รูปแบบ: ชื่อ Sheet -> array ของหัวคอลัมน์ (ตามลำดับ)
 */
const DB_SCHEMA = {
  GovernanceDocuments: ['DocumentID', 'Title', 'DocumentType', 'ModuleKey', 'RelatedID', 'Version',
    'FileName', 'MimeType', 'FileURL', 'FileID', 'ReviewDate', 'Status', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],
  PDFDesignTemplates: ['TemplateID', 'TemplateName', 'PageSize', 'Orientation', 'SourceModule', 'SourceSheet',
    'DesignJSON', 'Status', 'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],
  // 1) ทะเบียนผู้ใช้งานและสิทธิ์ระบบ (PasswordHash/PasswordSalt = ล็อกอินหลังบ้าน)
  Users: ['UserID', 'Username', 'EmployeeCode', 'Email', 'FullName', 'Department', 'Role', 'Supervisor', 'Status',
    'PasswordHash', 'PasswordSalt',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 1a) ทะเบียนพนักงาน แยกจาก Users ซึ่งเป็นบัญชีล็อกอินของระบบ
  Employees: ['EmployeeID', 'EmployeeCode', 'PrefixTH', 'FirstNameTH', 'LastNameTH', 'Nickname',
    'PrefixEN', 'FirstNameEN', 'LastNameEN', 'Position', 'Department', 'UsernameAD', 'UPN',
    'Email', 'Status', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 1a2) รายการทรัพย์สิน/สิทธิ์ใช้งานที่พนักงานครอบครอง 1 พนักงานมีได้หลายรายการ
  EmployeeAssignments: ['AssignmentID', 'EmployeeID', 'EmployeeCode', 'Category', 'ItemName',
    'AssetID', 'AssetCode', 'IPAddressDHCP', 'Producer', 'Model', 'MacAddress', 'AssetNumber',
    'SerialNumber', 'OSSystem', 'HardwareSpec', 'SoftwareName', 'SoftwareLicense', 'PhoneNumber',
    'ScanUser', 'ScanFolder', 'Status', 'AssignedDate', 'ReturnedDate', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 1b) ตัวตนผู้ใช้ LINE และ session ฝั่งหน้าแจ้งซ่อม
  LineUsers: ['LineUserID', 'DisplayName', 'PictureURL', 'EmployeeCode', 'LinkedUserID',
    'FullName', 'Department', 'LinkStatus', 'FriendStatus', 'LastLoginAt',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // เก็บเฉพาะ hash ของ session token ห้ามเก็บ token plaintext
  LineSessions: ['SessionHash', 'LineUserID', 'ExpiresAt', 'RevokedAt', 'LastSeenAt',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 2) Audit Trail ของระบบเอง (ป้องกันการแก้ไข ดู Setup.gs > protectAuditSheet)
  AuditTrail: ['LogID', 'Timestamp', 'ActorEmail', 'ActorRole', 'Action', 'Module',
    'TargetSheet', 'TargetID', 'Detail', 'IPHint', 'Result'],

  // 2a) งานส่วนตัวของผู้ใช้ — Server กรอง OwnerEmail ทุกครั้ง ห้ามส่งงานข้ามผู้ใช้
  PersonalTasks: ['TaskID', 'OwnerEmail', 'Title', 'Description', 'Category', 'Priority',
    'Status', 'StartDate', 'DueDate', 'CompletedAt', 'Progress', 'Tags', 'Notes',
    'SortOrder', 'Recurrence', 'RecurrenceEndDate', 'RecurringParentID', 'LastReminderDate',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  TaskSubtasks: ['SubtaskID', 'TaskID', 'OwnerEmail', 'Title', 'Status', 'DueDate',
    'SortOrder', 'CompletedAt', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  TaskProgressLogs: ['ProgressLogID', 'TaskID', 'OwnerEmail', 'Progress', 'Note', 'LoggedAt',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  TaskLinks: ['LinkID', 'TaskID', 'OwnerEmail', 'Label', 'URL',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  TaskAttachments: ['AttachmentID', 'TaskID', 'OwnerEmail', 'FileName', 'MimeType', 'FileID', 'FileURL',
    'RegistryAttachmentID',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  TaskReminders: ['ReminderID', 'TaskID', 'OwnerEmail', 'RemindAt', 'Channel', 'Status',
    'CalendarEventID', 'LastSentAt', 'ErrorMessage',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 2b) Help Desk / Ticket ก่อนยกระดับเป็น Incident
  // RequesterPhone/Location = ข้อมูลผู้แจ้ง (ฝั่ง public) · PublicToken = รหัสติดตามสถานะแบบไม่ต้อง login
  // Rating/Feedback = ความพึงพอใจหลังปิดงาน
  // Outsource* = ข้อมูลการส่งต่อผู้ให้บริการภายนอกและเลขอ้างอิงงานซ่อม
  Tickets: ['TicketID', 'Title', 'RequesterEmail', 'RequesterName', 'RequesterPhone', 'Department',
    'Location', 'Category', 'Priority', 'ResponseSLAHours', 'ResponseDueAt',
    'ResolutionSLAHours', 'SLAHours', 'DueAt', 'AssetID', 'AssetName', 'Description',
    'Assignee', 'IsSecurity', 'IncidentID', 'Status', 'AcknowledgedAt', 'ResolvedAt',
    'Resolution', 'CloseDate', 'EvidenceLink',
    'PublicToken', 'PublicTokenHash', 'RequesterIdentityType', 'RequesterLineUserID', 'SourceChannel',
    'Rating', 'Feedback', 'FeedbackAt',
    'OutsourceVendorID', 'OutsourceName', 'OutsourceIssueNo', 'OutsourceSentAt', 'Notes',
    'SLAPausedAt', 'SLAPausedMs', 'SLAPausedBusinessMinutes', 'ReopenCount',
    'SourceServiceRequestID', 'AttachmentIDsJSON', 'IdempotencyKey',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 2c) หมวดหมู่ Ticket และค่า SLA ตั้งต้น
  TicketCategories: ['CategoryID', 'CategoryName', 'DefaultPriority', 'ResponseSLAHours',
    'ResolutionSLAHours', 'SLAHours',
    'IsSecurityDefault', 'Status', 'Notes', 'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 2d) ประวัติการดำเนินงาน Ticket (Worklog) — 1 แถวต่อ 1 การกระทำ
  Ticket_Worklogs: ['WorklogID', 'TicketID', 'Action', 'Detail', 'StatusFrom', 'StatusTo',
    'MinutesSpent', 'AttachmentURL', 'IsPublic', 'ActorEmail', 'ActorName',
    'ActorIdentityType', 'ActorLineUserID',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 2e) ฐานความรู้ (Knowledge Base) — บทความวิธีแก้ปัญหาที่พบบ่อย ลดงานซ้ำของ Help Desk
  // Status = เผยแพร่/ร่าง · Views/Helpful = สถิติการใช้งาน · Category ผูกกับหมวด Ticket
  KnowledgeBase: ['ArticleID', 'Title', 'Category', 'Symptom', 'Solution', 'Tags', 'Status',
    'Views', 'Helpful', 'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 3) ทะเบียนทรัพย์สินสารสนเทศ
  // ฟิลด์ชุดแรก = ISMS เดิม (Patch/Criticality/License) · ชุดหลัง = ขยายตามสเปก IT Asset Management
  AssetRegister: ['AssetID', 'AssetName', 'AssetType', 'Vendor', 'Model', 'LicenseNo',
    'LicenseExpiry', 'Location', 'Owner', 'PatchStatus', 'PatchDate', 'Criticality',
    'Status', 'Notes',
    'AssetCode', 'Category', 'Brand', 'SerialNumber', 'PurchaseDate', 'WarrantyExpire', 'Price',
    'OwnerName', 'OwnerEmail', 'OwnerEmployeeCode', 'Department', 'VendorID', 'QRCodeURL', 'Remark',
    'IPAddressDHCP', 'MacAddress', 'OSSystem', 'HardwareSpec',
    'UsefulLifeYears', 'LastAuditDate', 'LastAuditBy', 'AuditStatus',
    'LoanDate', 'LoanDueDate',
    'SourceServiceRequestID',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 3a2) หมวดหมู่ทรัพย์สิน (แก้ไขได้จาก UI · CodePrefix ใช้สร้างรหัสอัตโนมัติ)
  AssetCategories: ['CategoryID', 'CategoryName', 'CodePrefix', 'Status', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 3b) ประวัติยืม/คืน/โอนย้าย Asset (Asset_History)
  Asset_History: ['MovementID', 'AssetID', 'AssetName', 'ActionType', 'FromUser',
    'ToUser', 'Department', 'Location', 'ActionDate', 'RelatedTicketID', 'Status',
    'EvidenceLink', 'Notes', 'DueDate', 'Condition',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 3c) แผน PM / บำรุงรักษา (Recurrence = ครั้งเดียว/รายเดือน/รายไตรมาส/รายปี)
  MaintenancePlans: ['MaintenanceID', 'AssetID', 'AssetName', 'PlanDate', 'ActualDate',
    'Checklist', 'Result', 'Status', 'Technician', 'Recurrence', 'NextDueDate', 'EvidenceLink', 'Notes',
    'ChecklistJSON', 'PlanNo', 'PlanName', 'CalendarYear', 'FiscalYear', 'TemplateID', 'StartDate', 'EndDate',
    'BackupTechnician', 'Department', 'Reviewer', 'Approver', 'VendorID', 'ContractNo', 'SLAHours',
    'Budget', 'EstimatedCost', 'Priority', 'ActiveFlag',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 3c2) เทมเพลตเช็กลิสต์ PM (ItemsJSON = array ของหัวข้อตรวจ) ผูกตามประเภท/หมวดเครื่อง
  PMChecklistTemplates: ['TemplateID', 'Name', 'Category', 'ItemsJSON', 'Status', 'Notes',
    'Description', 'Version', 'EffectiveDate', 'PreparedBy', 'ReviewedBy', 'ApprovedBy',
    'RecommendedRecurrence', 'EstimatedMinutes', 'SafetyInstructions', 'RequiredTools', 'RelatedDocuments',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  PMSchedules: ['ScheduleID', 'MaintenanceID', 'AssetID', 'TemplateID', 'DueDate', 'Status',
    'WorkOrderID', 'SourceKey', 'CalendarEventID', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  PMWorkOrders: ['WorkOrderID', 'WorkOrderNo', 'MaintenanceID', 'ScheduleID', 'AssetID', 'AssetName',
    'TemplateID', 'DueDate', 'StartAt', 'CompletedAt', 'Assignee', 'Participants', 'VendorID',
    'Reviewer', 'Approver', 'Status', 'Priority', 'SLAHours', 'LaborCost', 'PartCost', 'OtherCost',
    'TotalCost', 'Problem', 'Cause', 'InitialAction', 'Recommendation', 'Summary', 'ConditionScore',
    'NextDueDate', 'EvidenceLinksJSON', 'RelatedTicketID', 'Revision', 'IdempotencyKey', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  PMChecklistResults: ['ResultID', 'WorkOrderID', 'TemplateID', 'ItemID', 'Sequence', 'Category', 'Title',
    'AnswerType', 'AnswerValue', 'Unit', 'StandardValue', 'MinValue', 'MaxValue', 'RequiredFlag',
    'PassFlag', 'Severity', 'Score', 'EvidenceLinksJSON', 'Note',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  PMFindings: ['FindingID', 'WorkOrderID', 'AssetID', 'Title', 'Description', 'Severity', 'Status',
    'Owner', 'DueDate', 'CorrectiveAction', 'RelatedTicketID', 'EvidenceLinksJSON', 'ClosedAt', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  PMStatusHistory: ['HistoryID', 'WorkOrderID', 'StatusFrom', 'StatusTo', 'Action', 'Comment',
    'ActorEmail', 'ActionAt', 'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 3d) คลังวัสดุ/อะไหล่ IT
  Inventory: ['ItemID', 'ItemName', 'Category', 'Unit', 'StockQty', 'MinQty', 'Location',
    'Status', 'Notes', 'UnitPrice', 'ReorderQty',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 3e) ประวัติรับเข้า/จ่ายออกคลัง (BalanceAfter = ยอดคงเหลือหลังรายการ · Variance = ผลต่างจากการตรวจนับ)
  InventoryTransactions: ['TransactionID', 'ItemID', 'ItemName', 'TransactionType', 'Qty',
    'TicketID', 'ActionDate', 'Notes', 'BalanceAfter', 'Variance',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 3f) Software License แยกจาก Asset เพื่อบริหารจำนวนสิทธิ์และวันหมดอายุ
  SoftwareLicenses: ['LicenseID', 'SoftwareName', 'LicenseType', 'TotalQty', 'UsedQty',
    'StartDate', 'ExpireDate', 'VendorID', 'AssignedTo', 'Status', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 4) การจัดประเภทและคุ้มครองข้อมูล
  DataClassification: ['DataID', 'DataName', 'SystemName', 'Classification', 'DataOwner',
    'Custodian', 'StorageMethod', 'RetentionPeriod', 'DestructionDue', 'ContainsPersonalData',
    'Status', 'Notes', 'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 4b) คำขออนุมัติทำลายข้อมูล (Workflow)
  DataDestructionRequests: ['ReqID', 'DataID', 'DataName', 'Classification', 'Reason',
    'Requester', 'RequestDate', 'ApproverRequired', 'Approver', 'ApproveDate', 'Status',
    'DestroyMethod', 'DestroyDate', 'DestroyedBy', 'EvidenceLink', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 4c) PDPA: RoPA, หลักฐานความยินยอม และคำขอใช้สิทธิของเจ้าของข้อมูล
  PrivacyROPA: ['RopaID', 'ProcessName', 'Department', 'DataOwner', 'Purpose', 'LawfulBasis',
    'DataSubjects', 'PersonalData', 'SensitiveData', 'Recipients', 'CrossBorderTransfer',
    'RetentionPeriod', 'SecurityMeasures', 'DPIARequired', 'DPIAStatus', 'ReviewDate', 'Status', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],
  PrivacyConsents: ['ConsentID', 'DataSubjectRef', 'Purpose', 'NoticeVersion', 'Channel',
    'GrantedAt', 'WithdrawnAt', 'Status', 'EvidenceLink', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],
  PrivacyDSR: ['RequestID', 'RequestType', 'DataSubjectRef', 'Contact', 'IdentityVerifiedAt',
    'ReceivedAt', 'DueDate', 'Owner', 'Status', 'Decision', 'CompletedAt', 'EvidenceLink', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  Problems: ['ProblemID', 'Title', 'Category', 'AffectedSystem', 'RelatedIncidentIDs', 'RelatedTicketIDs',
    'Impact', 'RootCause', 'Workaround', 'PermanentFix', 'Owner', 'Priority', 'Status', 'ReviewDate',
    'ClosedAt', 'EvidenceLink', 'Notes', 'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],
  KnownErrors: ['KnownErrorID', 'ProblemID', 'Title', 'Symptoms', 'RootCause', 'Workaround',
    'AffectedVersions', 'FixedVersion', 'KnowledgeArticleID', 'Status', 'ReviewDate', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],
  VulnerabilityFindings: ['VulnerabilityID', 'Title', 'AssetID', 'AffectedSystem', 'Source', 'CVE',
    'CVSS', 'Severity', 'Description', 'DetectedAt', 'Owner', 'RemediationPlan', 'DueDate', 'Status',
    'ExceptionReason', 'ExceptionExpiry', 'VerifiedAt', 'VerifiedBy', 'EvidenceLink', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],
  AuditEngagements: ['AuditID', 'Title', 'AuditType', 'Scope', 'Criteria', 'LeadAuditor', 'Auditee',
    'PlannedStart', 'PlannedEnd', 'Status', 'Conclusion', 'ReportLink', 'ClosedAt', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],
  AuditFindings: ['FindingID', 'AuditID', 'Title', 'FindingType', 'Requirement', 'Evidence', 'RootCause',
    'ActionPlan', 'Owner', 'DueDate', 'Status', 'CompletedAt', 'VerifiedBy', 'VerifiedAt', 'EvidenceLink', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 4d) CMDB — Configuration Items และความสัมพันธ์ทั้ง CI/Asset/Vendor/Backup/Incident/Change
  ConfigurationItems: ['CIID', 'CIName', 'CIType', 'Environment', 'BusinessService', 'Owner',
    'Administrator', 'Criticality', 'IPAddress', 'URL', 'Version', 'VendorID', 'ContractRef',
    'AssetID', 'CloudID', 'DataClassification', 'RPOHours', 'RTOHours', 'BackupRequired',
    'BackupReference', 'Location', 'Status', 'LastVerifiedAt', 'LastVerifiedBy', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  CIRelationships: ['RelationshipID', 'SourceType', 'SourceID', 'SourceName', 'TargetType',
    'TargetID', 'TargetName', 'RelationshipType', 'Direction', 'ImpactLevel', 'Description',
    'Status', 'ValidFrom', 'ValidUntil', 'LastVerifiedAt', 'LastVerifiedBy', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 4e) Service Catalog / Request Fulfilment — แยกนิยามบริการ คำขอ งานย่อย และ Timeline
  ServiceCatalog: ['CatalogID', 'ServiceCode', 'ServiceName', 'Category', 'Description',
    'Eligibility', 'FormSchemaJSON', 'AttachmentRequired', 'SLAHours', 'ApprovalMode',
    'Approver', 'FulfillmentGroup', 'ChecklistJSON', 'WorkflowJSON', 'CloseMode',
    'CloseCondition', 'WorkflowDefinitionID', 'FulfillmentTarget', 'AutoCreateTarget',
    'TargetMappingJSON', 'Status', 'Version', 'PublishedAt', 'Owner', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  ServiceRequests: ['RequestID', 'CatalogID', 'CatalogVersion', 'ServiceCode', 'ServiceName',
    'RequesterEmail', 'RequesterName', 'Department', 'RequestedFor', 'Summary',
    'RequestDetailsJSON', 'BusinessJustification', 'Priority', 'Impact', 'AttachmentURL',
    'SLAHours', 'DueAt', 'Approver', 'ApprovalStatus', 'ApprovedBy', 'ApprovedAt',
    'AssignedGroup', 'Assignee', 'Status', 'WorkflowJSON', 'ChecklistSnapshotJSON',
    'FulfillmentNotes', 'CompletionEvidence', 'RequesterConfirmedAt', 'RequesterConfirmation',
    'CompletedAt', 'ClosedAt', 'CancelReason', 'IdempotencyKey', 'SourceChannel',
    'WorkflowInstanceID', 'AttachmentIDsJSON', 'CompletionAttachmentIDsJSON',
    'RelatedTicketID', 'RelatedAccessRequestID',
    'RelatedAssetID', 'RelatedCIID', 'RelatedChangeID', 'IntegrationStatus',
    'IntegrationError', 'IntegratedAt', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  ServiceRequestTasks: ['TaskID', 'RequestID', 'Sequence', 'TaskName', 'TaskType',
    'OwnerGroup', 'Assignee', 'IsRequired', 'Status', 'DueAt', 'CompletedAt', 'CompletedBy',
    'EvidenceLink', 'EvidenceAttachmentIDsJSON', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  ServiceRequestHistory: ['HistoryID', 'RequestID', 'Action', 'StatusFrom', 'StatusTo',
    'Comment', 'ActorEmail', 'ActorRole', 'IsPublic', 'Timestamp', 'CreatedBy',
    'LastUpdatedBy', 'LastUpdatedAt'],

  // 4f) Workflow / Approval Engine กลาง — definition แยกจาก transaction และ snapshot version ต่อ instance
  WorkflowDefinitions: ['DefinitionID', 'WorkflowCode', 'WorkflowName', 'ModuleKey',
    'Description', 'Version', 'TriggerEvent', 'Mode', 'ConditionsJSON', 'SLAHours',
    'ReminderHours', 'EscalationHours', 'EscalationRole', 'IsDefault', 'Status',
    'ActiveFrom', 'ActiveTo', 'Revision', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  WorkflowSteps: ['StepID', 'DefinitionID', 'DefinitionVersion', 'StepOrder', 'StepCode', 'StepName',
    'ApprovalType', 'ApproverValue', 'Mode', 'MinApprovals', 'ConditionJSON',
    'SLAHours', 'ReminderHours', 'EscalationHours', 'EscalationApprover',
    'AllowDelegation', 'AllowReturn', 'Status', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  WorkflowInstances: ['InstanceID', 'DefinitionID', 'DefinitionVersion', 'ModuleKey',
    'RecordID', 'RecordLabel', 'RequesterEmail', 'RequesterDepartment', 'CurrentStepOrder',
    'Status', 'StartedAt', 'DueAt', 'CompletedAt', 'CancelledAt', 'ContextJSON',
    'ResultJSON', 'IdempotencyKey', 'Revision', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  WorkflowApprovals: ['ApprovalID', 'InstanceID', 'StepID', 'StepOrder', 'ApproverEmail',
    'OriginalApproverEmail', 'ApproverRole', 'ApprovalGroup', 'Status', 'Decision',
    'Comment', 'DueAt', 'RemindedAt', 'EscalatedAt', 'DelegatedAt', 'DecidedAt',
    'DecisionBy', 'SignatureHash', 'AttachmentIDsJSON', 'Revision', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  WorkflowHistory: ['HistoryID', 'InstanceID', 'ApprovalID', 'Action', 'StepOrder',
    'StatusFrom', 'StatusTo', 'ActorEmail', 'ActorRole', 'Comment', 'DetailJSON',
    'IsPublic', 'ActionAt', 'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  WorkflowDelegations: ['DelegationID', 'DelegatorEmail', 'DelegateEmail', 'ModuleKey',
    'DefinitionID', 'StartAt', 'EndAt', 'Reason', 'Status', 'RevokedAt', 'RevokedBy',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // ดัชนีไฟล์กลาง — ไฟล์ใน Drive ไม่ share link; download ผ่าน server หลังตรวจ row-level permission
  AttachmentRegistry: ['AttachmentID', 'StorageType', 'FileID', 'ExternalURL',
    'ParentFolderID', 'OriginalName', 'StoredName', 'Extension', 'ClaimedMimeType',
    'DetectedMimeType', 'SizeBytes', 'ChecksumSHA256', 'UploaderEmail', 'SourceChannel',
    'HomeModule', 'IsEvidence', 'Status', 'ValidationStatus', 'ScanStatus', 'HighestClassification',
    'ContainsPersonalData', 'EffectiveRetainUntil', 'ActiveLinkCount', 'LegalHoldCount',
    'SharingScope', 'UploadedAt', 'LastVerifiedAt', 'LastAccessedAt', 'AccessCount',
    'TrashedAt', 'TrashedBy', 'TrashReason', 'MigrationKey', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  AttachmentLinks: ['LinkID', 'AttachmentID', 'ModuleKey', 'EntitySheet', 'EntityID',
    'FieldName', 'AttachmentRole', 'AccessPolicy', 'Status', 'RetentionPolicyKey',
    'RetainUntil', 'LegalHold', 'LegalHoldReason', 'LinkedAt', 'LinkedBy',
    'UnlinkedAt', 'UnlinkedBy', 'MigrationKey', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  AttachmentAccessLog: ['AccessLogID', 'AttachmentID', 'ModuleKey', 'RecordID', 'Action',
    'ActorEmail', 'ActorRole', 'Result', 'Reason', 'FileSizeBytes', 'ActionAt',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  RecordLinks: ['LinkID', 'SourceModule', 'SourceRecordID', 'TargetModule', 'TargetRecordID',
    'LinkType', 'IsPrimary', 'Status', 'CreatedAt', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // Transactional outbox สำหรับ integration ข้ามโมดูล — retry ได้โดยไม่สร้างรายการซ้ำ
  IntegrationOutbox: ['IntegrationID', 'SourceModule', 'SourceRecordID', 'TargetModule',
    'Operation', 'IdempotencyKey', 'PayloadJSON', 'Status', 'AttemptCount', 'NextAttemptAt',
    'LastAttemptAt', 'CompletedAt', 'ErrorMessage', 'ResultRecordID', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  ActionPermissions: ['PermissionKey', 'ModuleKey', 'Action', 'Description', 'Status',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  RoleActionPermissions: ['MappingID', 'Role', 'PermissionKey', 'Effect', 'Status', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  UserPermissionOverrides: ['OverrideID', 'UserEmail', 'PermissionKey', 'Effect',
    'StartAt', 'EndAt', 'Reason', 'Status', 'ApprovedBy',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  ApprovalGroups: ['GroupID', 'GroupCode', 'GroupName', 'Department', 'Description',
    'Status', 'OwnerEmail', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  ApprovalGroupMembers: ['MemberID', 'GroupID', 'UserEmail', 'MemberRole', 'Priority',
    'ValidFrom', 'ValidUntil', 'Status', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 5) คำขอสิทธิ์การเข้าถึง (Workflow)
  AccessRequests: ['ReqID', 'RequesterEmail', 'RequesterName', 'Department', 'SystemName',
    'AccessLevel', 'Reason', 'RequestType', 'RequestDate', 'Approver', 'ApprovedBy', 'ApproveDate',
    'ApproveResult', 'ITHandler', 'ITActionDate', 'ITResult', 'Status', 'ReviewDue',
    'SourceServiceRequestID', 'WorkflowInstanceID', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 5b) ทะเบียนสิทธิ์ผู้ใช้งานปัจจุบัน (RBAC)
  UserAccessRegistry: ['AccessID', 'UserEmail', 'UserName', 'SystemName', 'AccessLevel',
    'GrantedBy', 'GrantDate', 'LastReviewDate', 'NextReviewDue', 'Status', 'SourceReqID', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 6) การควบคุมการเปลี่ยนแปลงระบบงาน (Change Management)
  ChangeRequests: ['ChangeID', 'Title', 'SystemAffected', 'ChangeType', 'Description',
    'Requester', 'RequestDate', 'ImpactAssessment', 'RiskLevel', 'TestResult', 'TestSignOffBy',
    'Approver', 'ApproveDate', 'ApproveResult', 'DeployDate', 'DeployBy', 'Version', 'RollbackPlan',
    'Status', 'SourceServiceRequestID', 'WorkflowInstanceID', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 7) บันทึกผลการสำรองข้อมูล
  BackupLog: ['BackupID', 'SystemName', 'BackupType', 'BackupDate', 'Result', 'DataSize',
    'StorageLocation', 'Operator', 'NextBackupDue', 'EvidenceLink',
    'SnapshotFileID', 'SourceSpreadsheetID', 'Checksum', 'RowCount', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 7b) บันทึกผลทดสอบกู้คืนข้อมูล
  RecoveryTests: ['TestID', 'SystemName', 'TestDate', 'Scenario', 'Result', 'RTO_Actual',
    'RPO_Actual', 'Tester', 'NextTestDue', 'EvidenceLink', 'Findings', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 7c) ทะเบียนแผนฉุกเฉิน (BCP/DR)
  BCPPlans: ['PlanID', 'PlanName', 'Scope', 'Owner', 'LastReviewDate', 'NextReviewDue',
    'LastInvokedDate', 'InvokeReason', 'DocumentLink', 'Status', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 8) ทะเบียนระบบที่ต้องบันทึก Log
  LoggingRegister: ['LogSysID', 'SystemName', 'LogType', 'LogLocation', 'ReviewFrequency',
    'Responsible', 'LastReviewDate', 'NextReviewDue', 'RetentionPeriod', 'Status', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 8b) บันทึกผลการตรวจสอบ Log
  LogReviews: ['ReviewID', 'LogSysID', 'SystemName', 'ReviewDate', 'Reviewer', 'Period',
    'AnomalyFound', 'AnomalyDetail', 'ActionTaken', 'Status', 'EvidenceLink', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 9) การบริหารจัดการเหตุการณ์ (Incident Response)
  // Likelihood/Impact = ระดับ 1-5 สำหรับเมทริกซ์ความเสี่ยง · RiskScore = Likelihood × Impact (1-25)
  Incidents: ['IncidentID', 'Title', 'ReportedBy', 'ReportDate', 'Category', 'Severity',
    'Likelihood', 'Impact', 'RiskScore',
    'Description', 'AffectedSystem', 'ContainsPersonalData', 'Assignee', 'DPONotified',
    'DPONotifyDeadline', 'Status', 'RootCause', 'Resolution', 'LessonsLearned', 'CloseDate',
    'EvidenceLink', 'RegulatoryAssessmentStatus', 'BreachRiskLevel',
    'PDPCNotifyRequired', 'DataSubjectNotifyRequired', 'NCSAReportRequired',
    'OtherRegulatorRequired', 'RegulatoryAssessment', 'RegulatoryAssessmentAt',
    'RegulatoryAssessedBy', 'Notes', 'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt',
    'SourceTicketID'],

  // 9a2) ประวัติการแจ้งหน่วยงานกำกับ/เจ้าของข้อมูล (หนึ่ง Incident แจ้งได้หลายหน่วยงาน)
  RegulatoryNotifications: ['NotificationID', 'IncidentID', 'Agency', 'NotificationType',
    'Required', 'LegalBasis', 'Deadline', 'Status', 'NotifiedAt', 'ReferenceNo',
    'ApprovedBy', 'EvidenceLink', 'ReasonNotRequired', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 9b) ทะเบียนความเสี่ยงสารสนเทศ (Risk Register) — ISO/IEC 27001 ข้อ 6.1.2 / 8.2 / 8.3
  // Likelihood/Impact = 1-5 · RiskScore = Likelihood × Impact (1-25) · RiskLevel = ต่ำ/ปานกลาง/สูง/วิกฤต
  // Treatment = ยอมรับ/ลด/โอน/หลีกเลี่ยง · Residual* = ความเสี่ยงคงเหลือหลังใส่มาตรการ
  RiskRegister: ['RiskID', 'Title', 'Category', 'RelatedAsset', 'RelatedSystem', 'Threat',
    'Vulnerability', 'Owner', 'Likelihood', 'Impact', 'RiskScore', 'RiskLevel',
    'Treatment', 'ExistingControls', 'TreatmentPlan', 'TreatmentOwner', 'DueDate',
    'ResidualLikelihood', 'ResidualImpact', 'ResidualScore', 'ResidualLevel',
    'Status', 'IdentifiedDate', 'LastReviewDate', 'NextReviewDue', 'RelatedIncidentID', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 9c) ธรรมาภิบาลกฎหมายและการปฏิบัติตาม
  LegalRegister: ['LawID', 'LawName', 'ShortName', 'Authority', 'Version', 'EffectiveDate',
    'ApplicabilityStatus', 'ApplicabilityReason', 'Owner', 'SourceURL',
    'LastReviewDate', 'NextReviewDue', 'Status', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  ComplianceObligations: ['ObligationID', 'LawID', 'Clause', 'Requirement', 'ControlDomain',
    'ControlOwner', 'Frequency', 'EvidenceRequired', 'RelatedModule', 'ApplicabilityStatus',
    'DueDate', 'Status', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  ComplianceAssessments: ['AssessmentID', 'ObligationID', 'AssessmentDate', 'Assessor',
    'Result', 'ControlDescription', 'EvidenceLink', 'GapDescription', 'NextReviewDue', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  CorrectiveActions: ['ActionID', 'ObligationID', 'AssessmentID', 'Title', 'RootCause',
    'ActionPlan', 'Owner', 'Priority', 'DueDate', 'Status', 'CompletedDate',
    'VerificationResult', 'VerifiedBy', 'EvidenceLink', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 10) ทะเบียนผู้ให้บริการภายนอก (ServiceType/Phone/Email = ชุดสเปก, ServiceScope/ContactInfo = ISMS เดิม)
  VendorRegister: ['VendorID', 'VendorName', 'ServiceScope', 'ServiceType', 'ContractNo', 'ContractStart',
    'ContractExpiry', 'ContactPerson', 'Phone', 'Email', 'ContactInfo', 'Owner', 'AssessmentResult',
    'AssessmentDate', 'Status', 'Notes', 'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 11) ทะเบียนเครื่องมือ AI
  AIRegister: ['AIID', 'ToolName', 'Vendor', 'Purpose', 'AllowedDataTypes', 'ProhibitedDataTypes',
    'Owner', 'ApprovalRef', 'Status', 'Notes', 'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 12) ทะเบียนระบบ Cloud
  CloudRegister: ['CloudID', 'ServiceName', 'Provider', 'Purpose', 'AllowedDataClass', 'Owner',
    'ApprovalRef', 'BackupArrangement', 'ExitPlan', 'ContractExpiry', 'Status', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 13) แผนอบรมประจำปี
  // QuizJSON = ชุดคำถามแบบทดสอบหลังอบรม (JSON) · PassingScore = เกณฑ์ผ่าน (%)
  TrainingPlans: ['PlanID', 'Year', 'Quarter', 'Topic', 'TargetGroup', 'PlannedDate',
    'Responsible', 'Status', 'Notes', 'QuizJSON', 'PassingScore',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 13b) บันทึกการเข้าอบรม (Passed = ผ่านแบบทดสอบหรือไม่: Yes/No)
  TrainingRecords: ['RecID', 'PlanID', 'Topic', 'TrainingDate', 'AttendeeEmail', 'AttendeeName',
    'Department', 'Result', 'Score', 'Passed', 'EvidenceLink', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 13c) แบบรับทราบนโยบายออนไลน์ (e-sign แบบง่าย)
  PolicyAcknowledgements: ['AckID', 'PolicyName', 'PolicyVersion', 'AcknowledgerEmail',
    'AcknowledgerName', 'Department', 'AckDate', 'SignatureName', 'Confirmed', 'IPHint',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 14) บันทึกการแจ้งเตือนที่ส่งออก (Notification Engine)
  NotificationLog: ['NotifyID', 'SentAt', 'Channel', 'Recipient', 'Subject', 'RefModule',
    'RefID', 'Result', 'ErrorMsg'],

  // 14b) Outbox สำหรับ LINE: retry แบบ exponential backoff + dedup + dead letter
  NotificationQueue: ['QueueID', 'CreatedAt', 'Channel', 'Recipient', 'Subject', 'Message',
    'RefModule', 'RefID', 'DedupKey', 'Status', 'AttemptCount', 'NextAttemptAt',
    'LastAttemptAt', 'LastError', 'SentAt',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 14c) ผลการประมวลผลนโยบายเก็บรักษา/ทำลายข้อมูล
  RetentionLog: ['RunID', 'RunAt', 'Mode', 'Policy', 'SheetName', 'Action',
    'MatchedRows', 'AffectedRows', 'Status', 'Detail', 'RunBy',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 14c2) ตัวนับ rate limit แบบชั่วคราว ย้ายออกจาก Script Properties เพื่อไม่ชน quota
  RateLimits: ['RateKey', 'Scope', 'Bucket', 'Count', 'ExpiresAt',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 14d) Joiner / Mover / Leaver checklist
  EmployeeLifecycle: ['LifecycleID', 'EmployeeID', 'EmployeeCode', 'EmployeeEmail',
    'EventType', 'EffectiveDate', 'OldDepartment', 'NewDepartment', 'OldPosition',
    'NewPosition', 'Status', 'AccountsDisabled', 'AccessAffected', 'LineSessionsRevoked',
    'AssetsPending', 'ChecklistJSON', 'Reason', 'CompletedAt', 'CompletedBy', 'Notes',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 15) ตั้งค่าระบบทั่วไปที่ไม่ใช่ความลับ
  Settings: ['Key', 'Value', 'Description', 'Group', 'UpdatedAt', 'UpdatedBy'],

  // 15b) Metadata สำหรับตัวออกแบบฟิลด์ในหน้า Settings
  // เก็บเฉพาะชื่อแสดง/ชนิดข้อมูล/ตัวเลือก — ข้อมูลจริงยังอยู่ใน Sheet ของแต่ละโมดูล
  FieldDefinitions: ['FieldID', 'ModuleKey', 'SheetName', 'FieldKey', 'DisplayName', 'DataType',
    'IsRequired', 'Options', 'IsSystem', 'Status', 'UpdatedAt', 'UpdatedBy',
    'Timestamp', 'CreatedBy', 'LastUpdatedBy', 'LastUpdatedAt'],

  // 16) Tester / QA
  QATestCases: ['CaseID', 'Module', 'Scenario', 'Steps', 'Expected', 'Actual', 'Status',
    'Priority', 'Tester', 'TestedAt', 'Notes', 'Timestamp', 'CreatedBy', 'LastUpdatedBy',
    'LastUpdatedAt'],

  // ตารางอ้างอิง Feature ↔ Policy (ใช้ใน Audit Evidence Center)
  PolicyMapping: ['MapID', 'Module', 'Feature', 'PolicyDocument', 'PolicyClause', 'Description']
};

/**
 * เมทริกซ์สิทธิ์การเข้าถึงโมดูล: moduleKey -> { label, roles[], readOnlyRoles[] }
 * ใช้ทั้งฝั่ง UI (แสดงเมนู) และฝั่ง Server (requireModule) — ตรวจซ้ำที่ Server เสมอ
 */
const MODULE_ACCESS = {
  dashboard:      { label: 'Dashboard',                  group: 'งานหลัก', roles: ['User','Approver','ITAdmin','Executive','DPO'] },
  task:           { label: 'Task / งานของฉัน',           group: 'งานหลัก', roles: ['User','Approver','ITAdmin','Executive','DPO'] },
  workflow:       { label: 'Workflow / งานอนุมัติ',       group: 'งานหลัก', roles: ['User','Approver','ITAdmin','Executive','DPO'] },
  calendar:       { label: 'ปฏิทินรวม',                  group: 'งานหลัก', roles: ['User','Approver','ITAdmin','Executive','DPO'] },
  ticket:         { label: 'Ticket แจ้งซ่อม',             group: 'งานหลัก', roles: ['User','Approver','ITAdmin'], readOnlyRoles: ['Executive'] },
  serviceCatalog: { label: 'Service Catalog / คำขอบริการ', group: 'งานหลัก', roles: ['User','Approver','ITAdmin','Executive','DPO'] },
  kb:             { label: 'ฐานความรู้ (KB)',             group: 'งานหลัก', roles: ['ITAdmin'], readOnlyRoles: ['User','Approver','Executive','DPO'] },
  asset:          { label: 'IT Asset',                    group: 'งานหลัก', roles: ['ITAdmin'], readOnlyRoles: ['Executive'] },
  borrow:         { label: 'ยืม / คืน Asset',             group: 'งานหลัก', roles: ['ITAdmin'], readOnlyRoles: ['Approver','Executive'] },
  maintenance:    { label: 'PM / บำรุงรักษา',             group: 'งานหลัก', roles: ['ITAdmin'], readOnlyRoles: ['Approver','Executive'] },

  inventory:      { label: 'Inventory',                   group: 'ข้อมูลและรายงาน', roles: ['ITAdmin'], readOnlyRoles: ['Executive'] },
  employees:      { label: 'พนักงานและทรัพย์สิน',          group: 'ข้อมูลและรายงาน', roles: ['ITAdmin'], readOnlyRoles: ['Executive'] },
  license:        { label: 'Software License',            group: 'ข้อมูลและรายงาน', roles: ['ITAdmin'], readOnlyRoles: ['Executive'] },
  vendor:         { label: 'Vendor / Contract',           group: 'ข้อมูลและรายงาน', roles: ['ITAdmin'], readOnlyRoles: ['Executive'] },
  cmdb:           { label: 'CMDB / Relationship Map',      group: 'ข้อมูลและรายงาน', roles: ['ITAdmin'], readOnlyRoles: ['Approver','Executive','DPO'] },
  reports:        { label: 'Reports',                     group: 'ข้อมูลและรายงาน', roles: ['ITAdmin','Executive','DPO'] },

  users:          { label: 'Users',                       group: 'ระบบ', roles: ['ITAdmin'] },
  settings:       { label: 'Settings',                    group: 'ระบบ', roles: ['ITAdmin'] },
  auditTrail:     { label: 'Audit Log',                   group: 'ระบบ', roles: ['ITAdmin'], readOnlyRoles: ['Executive'] },
  tester:         { label: 'Tester / QA',                 group: 'ระบบ', roles: ['ITAdmin'] },
  notification:   { label: 'ตั้งค่าการแจ้งเตือน',          group: 'ระบบ', roles: ['ITAdmin'] },

  dataClass:      { label: 'การจัดประเภทและคุ้มครองข้อมูล',     group: 'ธรรมาภิบาล กฎหมาย และ ISMS', roles: ['ITAdmin'], readOnlyRoles: ['Executive','DPO'] },
  privacy:        { label: 'Privacy / PDPA',                   group: 'ธรรมาภิบาล กฎหมาย และ ISMS', roles: ['ITAdmin','DPO'], readOnlyRoles: ['Executive'] },
  problem:        { label: 'Problem / Known Error',            group: 'งานหลัก', roles: ['ITAdmin'], readOnlyRoles: ['Approver','Executive'] },
  vulnerability:  { label: 'Vulnerability / Patch',            group: 'ธรรมาภิบาล กฎหมาย และ ISMS', roles: ['ITAdmin'], readOnlyRoles: ['Executive','DPO'] },
  audit:          { label: 'Audit Management',                 group: 'ตรวจสอบและตั้งค่า', roles: ['ITAdmin'], readOnlyRoles: ['Executive','DPO'] },
  access:         { label: 'การบริหารสิทธิ์การเข้าถึง',         group: 'ธรรมาภิบาล กฎหมาย และ ISMS', roles: ['User','Approver','ITAdmin'], readOnlyRoles: ['Executive'] },
  change:         { label: 'การควบคุมการเปลี่ยนแปลงระบบงาน',    group: 'ธรรมาภิบาล กฎหมาย และ ISMS', roles: ['ITAdmin','Approver'], readOnlyRoles: ['Executive'] },
  backup:         { label: 'การสำรองข้อมูลและแผนฉุกเฉิน',       group: 'ธรรมาภิบาล กฎหมาย และ ISMS', roles: ['ITAdmin'], readOnlyRoles: ['Executive'] },
  logging:        { label: 'Logging & Monitoring',            group: 'ธรรมาภิบาล กฎหมาย และ ISMS', roles: ['ITAdmin'], readOnlyRoles: ['Executive'] },
  incident:       { label: 'การบริหารจัดการเหตุการณ์',          group: 'ธรรมาภิบาล กฎหมาย และ ISMS', roles: ['User','Approver','ITAdmin','DPO'], readOnlyRoles: ['Executive'] },
  risk:           { label: 'ทะเบียนความเสี่ยง (Risk Register)',  group: 'ธรรมาภิบาล กฎหมาย และ ISMS', roles: ['ITAdmin','Approver'], readOnlyRoles: ['Executive','DPO'] },
  compliance:     { label: 'กฎหมายและการปฏิบัติตาม',             group: 'ธรรมาภิบาล กฎหมาย และ ISMS', roles: ['ITAdmin','DPO'], readOnlyRoles: ['Executive','Approver'] },
  ai:             { label: 'ทะเบียนเครื่องมือ AI',             group: 'ธรรมาภิบาล กฎหมาย และ ISMS', roles: ['ITAdmin'], readOnlyRoles: ['User','Approver','Executive','DPO'] },
  cloud:          { label: 'ทะเบียนระบบ Cloud',               group: 'ธรรมาภิบาล กฎหมาย และ ISMS', roles: ['ITAdmin'], readOnlyRoles: ['User','Approver','Executive','DPO'] },
  awareness:      { label: 'การสร้างความตระหนัก/อบรม',          group: 'ธรรมาภิบาล กฎหมาย และ ISMS', roles: ['User','Approver','ITAdmin','Executive','DPO'] },
  evidence:       { label: 'ศูนย์รวมหลักฐานตรวจสอบ',           group: 'ตรวจสอบและตั้งค่า', roles: ['ITAdmin','Executive'] }
};
