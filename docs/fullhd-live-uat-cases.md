# Live UAT — executed results

Source commit: 72f5a37d5b9d4bad8183cba71fd94497424a6e6f. Environment: GitHub staging.

Evidence: [Staging Live E2E run 40815047128](https://github.com/nitithornct-ops/APP-IT-LIFE/actions/runs/40815047128) and its staging-e2e-evidence artifact.

Browser suite: 263 passed, 0 failed, 0 skipped, 0 flaky. Live-only Chromium UAT: 30/30 passed.

This verifies the listed automated cases. It does not assert coverage of every possible workflow, role/data combination or external delivery channel.

| # | Spec | Case | Result |
|---|---|---|---|
| 1 | assets-modal.live.spec.ts | asset create, edit and action forms open as bounded popups | Passed |
| 2 | dashboard.live.spec.ts | live API returns role-aware and RLS-aware dashboard summaries | Passed |
| 3 | dashboard.live.spec.ts | admin dashboard renders operational cards and urgent data | Passed |
| 4 | dashboard.live.spec.ts | regular user dashboard keeps organizational records out of the personal view | Passed |
| 5 | employees-assets.live.spec.ts | employee register and all action forms render as bounded popups | Passed |
| 6 | external-uat.live.spec.ts | Requester completes its route and permission-boundary checks | Passed |
| 7 | external-uat.live.spec.ts | Technician completes its route and permission-boundary checks | Passed |
| 8 | external-uat.live.spec.ts | Approver completes its route and permission-boundary checks | Passed |
| 9 | external-uat.live.spec.ts | Manager completes its route and permission-boundary checks | Passed |
| 10 | external-uat.live.spec.ts | Admin completes its route and permission-boundary checks | Passed |
| 11 | external-uat.live.spec.ts | Vendor accesses the isolated company portal with an AAL2 session on mobile | Passed |
| 12 | governance.live.spec.ts | live API covers all active Governance surfaces, workflows and RBAC | Passed |
| 13 | governance.live.spec.ts | admin UI renders all sections and creates a high risk record | Passed |
| 14 | governance.live.spec.ts | regular user sees only AI/Awareness and can e-sign policy | Passed |
| 15 | maintenance-modal.live.spec.ts | PM dashboard and every primary action use bounded popups | Passed |
| 16 | reports.live.spec.ts | live API returns every standard report, enforces RBAC and records exports | Passed |
| 17 | reports.live.spec.ts | admin UI renders report controls, data and all report tabs | Passed |
| 18 | reports.live.spec.ts | regular employee is denied the Report Center route | Passed |
| 19 | serviceCatalog.live.spec.ts | workspace matches catalog, request and management flows | Passed |
| 20 | settings-audit.live.spec.ts | live API enforces Settings and Audit role boundaries | Passed |
| 21 | settings-audit.live.spec.ts | administrator can view and safely edit an allowlisted setting | Passed |
| 22 | settings-audit.live.spec.ts | auditor can inspect Audit Trail and Login History without Settings access | Passed |
| 23 | tasks.live.spec.ts | task command center renders on desktop and switches to calendar | Passed |
| 24 | tasks.live.spec.ts | primary task actions call the API and update the interface | Passed |
| 25 | tasks.live.spec.ts | task command center remains contained on mobile | Passed |
| 26 | ticket-actions.live.spec.ts | opens the shared work panel from the Ticket list and explains final statuses | Passed |
| 27 | ticket-actions.live.spec.ts | sorts the Ticket list by SLA due date and keeps the sort across pages | Passed |
| 28 | ticket-actions.live.spec.ts | keeps the Ticket list filter and sort in the URL across reload and browser back | Passed |
| 29 | ticket-actions.live.spec.ts | selects tickets and reports bulk results per ticket | Passed |
| 30 | ticket-form.live.spec.ts | signs one Ticket and shows that signature on its automatic form | Passed |
