# Live UAT case inventory

These 30 Chromium cases are generated from the current Playwright inventory. Status must be populated from the staging artifact; inventory alone is not execution evidence.

| # | Spec | Case |
|---|---|---|
| 1 | assets-modal.live.spec.ts | asset create, edit and action forms open as bounded popups |
| 2 | dashboard.live.spec.ts | live API returns role-aware and RLS-aware dashboard summaries |
| 3 | dashboard.live.spec.ts | admin dashboard renders operational cards and urgent data |
| 4 | dashboard.live.spec.ts | regular user dashboard keeps organizational records out of the personal view |
| 5 | employees-assets.live.spec.ts | employee register and all action forms render as bounded popups |
| 6 | external-uat.live.spec.ts | Requester completes its route and permission-boundary checks |
| 7 | external-uat.live.spec.ts | Technician completes its route and permission-boundary checks |
| 8 | external-uat.live.spec.ts | Approver completes its route and permission-boundary checks |
| 9 | external-uat.live.spec.ts | Manager completes its route and permission-boundary checks |
| 10 | external-uat.live.spec.ts | Admin completes its route and permission-boundary checks |
| 11 | external-uat.live.spec.ts | Vendor accesses the isolated company portal with an AAL2 session on mobile |
| 12 | governance.live.spec.ts | live API covers all active Governance surfaces, workflows and RBAC |
| 13 | governance.live.spec.ts | admin UI renders all sections and creates a high risk record |
| 14 | governance.live.spec.ts | regular user sees only AI/Awareness and can e-sign policy |
| 15 | maintenance-modal.live.spec.ts | PM dashboard and every primary action use bounded popups |
| 16 | reports.live.spec.ts | live API returns every standard report, enforces RBAC and records exports |
| 17 | reports.live.spec.ts | admin UI renders report controls, data and all report tabs |
| 18 | reports.live.spec.ts | regular employee is denied the Report Center route |
| 19 | serviceCatalog.live.spec.ts | workspace matches catalog, request and management flows |
| 20 | settings-audit.live.spec.ts | live API enforces Settings and Audit role boundaries |
| 21 | settings-audit.live.spec.ts | administrator can view and safely edit an allowlisted setting |
| 22 | settings-audit.live.spec.ts | auditor can inspect Audit Trail and Login History without Settings access |
| 23 | tasks.live.spec.ts | task command center renders on desktop and switches to calendar |
| 24 | tasks.live.spec.ts | primary task actions call the API and update the interface |
| 25 | tasks.live.spec.ts | task command center remains contained on mobile |
| 26 | ticket-actions.live.spec.ts | opens the shared work panel from the Ticket list and explains final statuses |
| 27 | ticket-actions.live.spec.ts | sorts the Ticket list by SLA due date and keeps the sort across pages |
| 28 | ticket-actions.live.spec.ts | keeps the Ticket list filter and sort in the URL across reload and browser back |
| 29 | ticket-actions.live.spec.ts | selects tickets and reports bulk results per ticket |
| 30 | ticket-form.live.spec.ts | signs one Ticket and shows that signature on its automatic form |
