# Phase 7 — Data Migration Runbook

## Current decision gate

Status: **READY_FOR_IMPORT_REHEARSAL**. This is not approval to write to Production Supabase.

The read-only source is the immutable snapshot `ISMS_DB_SNAPSHOT_20260810_022753_AUTO_DAILY` (93 sheets, 1,932 rows). All mappings use header names, never column positions. The snapshot and Supabase remain unchanged by the profiling and dry-run commands.

## Reconciliation baseline

| Disposition | Rows |
|---|---:|
| Source total | 1,932 |
| Import candidates | 1,782 |
| Archive only | 143 |
| Skip ephemeral/security state | 6 |
| Deferred until after go-live | 1 |

The expected target operation count is 958 because 862 `RetentionLog` detail rows aggregate into 37 retention-run rows and some source sheets split into more than one target table. Reconcile by `legacy_source + legacy_id`, not by comparing whole-table totals against systems that already contain seed data.

## Mandatory transformation policies

- Users: invite/create Supabase Auth identities and force a new password. Never export or migrate `PasswordHash` or `PasswordSalt`. Map roles as `User → user`, `Approver → approver`, `ITAdmin → it_admin`, `Executive → executive`, and `DPO → dpo`.
- Settings: activate only the 52 allowlisted keys. Archive the five unsupported rows; never import secret-like settings.
- Historical notifications: archive 97 `NotificationLog` rows. Do not replay queues or create unread in-app notifications.
- Sessions and counters: skip four `LineSessions` rows and two `RateLimits` rows. Recreate runtime state in the new system.
- Soft deletion: archive four soft-deleted rows instead of activating them.
- Designer: defer the one `PDFDesignTemplates` row until after go-live. Its invalid `DesignJSON` is isolated from active imports.
- Retention: aggregate by `RunID`; keep the original per-sheet/action details in target JSON.
- LINE identity: migrate the one `LineUsers` registry row to `line_users`; never migrate legacy session hashes.

## Attachment exporter

Two paths must remain separate during export:

1. Registry path — `AttachmentRegistry` and `AttachmentLinks`, using the registry file ID/URL and relationship metadata.
2. Direct path — legacy `FileID`, `FileURL`, `AttachmentURL`, `EvidenceLink`, `EvidenceLinksJSON`, or `AttachmentIDsJSON` fields.

The current snapshot has no registry/task-attachment rows and has eight direct references: one ticket evidence link, five backup evidence links, and two recovery-test evidence links. The exporter must retrieve/copy file bytes in an access-controlled process, calculate a checksum, upload to the private Supabase bucket, then write `file_attachments`. Reports may contain sheet/row/column coordinates and counts but must never contain access-bearing locators.

## Import rehearsal order

1. Apply `20260828100000_migration_readiness.sql` in the rehearsal database.
2. Create invited auth users, profiles, roles, and permission mappings.
3. Import reference/master data: employees, approval groups, categories, catalog, vendors, and assets.
4. Import operational records: tasks, tickets/worklogs, service/access requests, workflow, and IT operations.
5. Import governance registers and aggregate retention history.
6. Import immutable audit history last; archive notification delivery history, QA rows, unsupported settings, and soft-deleted rows separately.
7. Migrate attachments after parent UUIDs exist, using the two-path exporter and the legacy-to-UUID row map.

Each step runs in a transaction-sized batch and upserts on `(legacy_source, legacy_id)`. A failed batch rolls back without deleting pre-existing target data.

## Acceptance criteria

- Manifest coverage is 93/93; schema readiness is 76/76 transformed target tables.
- Blocking data-quality counts remain zero: blank keys, duplicate natural keys, invalid required emails/dates, orphan foreign keys, unmapped roles, and suspected secret settings.
- Every import candidate has a reconciliation result: inserted, matched/upserted, archived, skipped, or failed with a row coordinate.
- Target relationships resolve to UUIDs and all attachment candidates have checksum/upload results or an explicit unresolved reason.
- No password hash, salt, LINE session hash, rate-limit counter, queued message, or secret setting reaches the migration bundle.
- The owner approves the rehearsal report before any Production import or user invitation is sent.

## Commands

```powershell
npm.cmd run dry-run --workspace=packages/migration
npm.cmd run test --workspace=packages/migration
npm.cmd run test --workspace=supabase
```

Generated evidence:

- `phase7-source-profile.json`
- `phase7-data-quality-profile.json`
- `phase7-dry-run-report.json` and `.md`
- `phase7-reconciliation-report.json`

## Import engine (built; waiting on real data)

`packages/migration/src/importPlan.ts` (planner) and `executor.ts` (batched transactional
writer) implement every policy above in code, not just prose. Coverage as of this writing:

- **Hand-verified against the real target schema** — `Users`, `ActionPermissions`,
  `RoleActionPermissions`, `ApprovalGroups`, `ApprovalGroupMembers`, `Employees`,
  `TicketCategories`, `LineUsers`, `Settings`, `RetentionLog`, `LegalRegister`, `AuditTrail`,
  `PolicyMapping`, `ServiceCatalog`, `ComplianceObligations`, `AssetCategories`, `BackupLog`,
  `PersonalTasks`, `Ticket_Worklogs`, `RecoveryTests`, `WorkflowDefinitions`,
  `WorkflowSteps`, `Tickets` — every sheet that is currently populated in the snapshot
  (`phase7-source-profile.json`'s `sourceRows > 0`), each proven against the actual
  accumulated Postgres schema via pglite in `supabase/tests/importExecution.test.ts` (not
  just fixtures — this test caught and fixed three real bugs: a missing partial-index
  predicate on the legacy-identity `ON CONFLICT`, an untyped `jsonb_build_object` parameter,
  and a jsonb `CHECK` constraint mismatch).
- **Generic snake_case fallback** — every other transform-mode sheet. These are currently
  empty in the snapshot, so there is nothing to get wrong yet; `ImportPlan.unverifiedSheets`
  lists exactly which ones so this is never silently mistaken for full coverage. Hand-verify
  a sheet here the same way as the others (real headers from `phase7-source-profile.json` +
  real target columns from `supabase/migrations/*.sql`) before it is expected to hold data.
- **Soft-deleted rows** (`IsDeleted` truthy, seen on `BackupLog`/`RecoveryTests`) are routed
  to `archived` automatically, for any sheet.
- `PolicyMapping` → `governance_controls` is a lower-confidence, best-effort mapping — the
  legacy sheet's shape (Module/Feature/PolicyDocument/PolicyClause) is only a loose match for
  the target's (control_code/domain/title/requirement). Worth a human review before trusting it.

### Running the rehearsal

Still blocked on two things only the system owner can supply:

1. **Real legacy row data.** `phase7-source-profile.json` intentionally stores no raw values
   (`rawDataStored: false`) — the source is a live Google Sheet with no credentials
   configured in this environment. Export it to a JSON file shaped like `LegacyWorkbook`
   (`{ "SheetName": [ {row}, ... ], ... }`, using the exact headers from
   `phase7-source-profile.json`) and point `LEGACY_WORKBOOK_PATH` at it.
2. **The real Settings allowlist** (52 keys per the last dry-run) — not stored in this repo
   either. Supply it as a JSON array via `SETTINGS_ALLOWLIST_PATH`, or every `Settings` row
   is archived rather than activated (safe default, not a bug).

```powershell
cd packages/migration
copy .env.example .env   # fill in LEGACY_WORKBOOK_PATH, SETTINGS_ALLOWLIST_PATH,
                          # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL
npm.cmd run rehearse
```

This writes `docs/migration/phase7-rehearsal-report.json` (plan summary + per-row
inserted/failed counts) and exits non-zero if anything failed, so it's safe to gate on in a
script. `SUPABASE_DB_URL` must be Supabase's direct connection string (Settings → Database →
Connection string → URI) — the executor holds one persistent connection so batched
transactions actually commit/rollback together, which a pooled connection would break. This
writes real rows through the Supabase Auth Admin API and a direct Postgres connection —
point it at a disposable rehearsal project, never Production, until the owner has reviewed
the report and explicitly approves a Production run (see "Acceptance criteria" above).
