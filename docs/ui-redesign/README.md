# LIFE IT enterprise console redesign

Branch: `ui/cloudflare-enterprise-redesign`. Base: `origin/master` at `1653d28`. Prepared on 11 November 2026 (Asia/Bangkok).

## Scope and implementation

The existing application now uses a white/light-gray enterprise console theme with orange actions and active navigation, LIFE navy headings and blue brand/chart accents. The same semantic tokens cover Light, Dark and System, shared module headers, forms, tables, overlays, public authentication and portal surfaces. Flat surfaces replace aurora gradients and glass blur; card shadows and radii are restrained. Sidebar remains 244/68px, topbar 64px and gutters 32/24/16px. Density, font scaling, navigation groups, favorites, keyboard search and drawer focus behavior are retained.

The implementation follows the existing architecture: inventory → semantic tokens → shared primitives → shell → dashboard → module inheritance → responsive and regression checks. See [route/component inventory](inventory.md) for all 67 route patterns and 31 shared source files. Module recovery geometry covers all 43 navigation entries. It does not prove every successful workflow.

## Tokens and accessibility decisions

Typography follow-up: reduced the UI root baseline from 16px to 15px (6.25%) so the user's 100% setting feels more compact. A−/A+ still scales the baseline normally; document point sizes and touch targets are preserved. Ran 12 existing shell/font/print regression checks and 3 login accessibility/visual checks against the updated local preview; all passed. Login baselines and login evidence are refreshed. The other Before/After images record the initial redesign before this small typography adjustment.

| Role | Light | Dark |
|---|---|---|
| Accent | #F6821F | #F6821F |
| Accent text | #182B49 | #182B49 |
| Action/link text | #B34D00 | #FFAB66 |
| Page | #F7F9FC | #101722 |
| Surface | #FFFFFF | #182231 |
| Sidebar | #FFFFFF | #141E2C |
| Selected menu | #FFF1E6 | #39291F |
| Heading | #182B49 | #F1F5F9 |
| Body | #243247 | #E2E8F0 |
| Muted | #64748B | #A3B2C5 |
| Border | #E2E7EE | #334155 |

Orange #F6821F with navy text has 5.49:1 contrast. Requested #C75A0A remains the accent hover token; white text on it measures 4.29:1, so button hover uses #B34D00 for AA readability. Links use a darker orange in Light mode. Inter and Noto Sans Thai are retained, and TH Sarabun New document metrics are unchanged. Existing reduced-motion handling remains. Automated axe checks cover selected surfaces, not full application WCAG certification.

## Screenshots

All screenshots use intercepted, synthetic test data. They contain no production data. Before images are from unmodified 1653d28. Final after screenshots use the production web build, except module recovery screenshots from the earlier development preview.

| Surface | Before | After |
|---|---|---|
| Ticket desktop | [Before](evidence/before/tickets-desktop.png) | [After](evidence/after/tickets-desktop.png) |
| Dashboard operations | [Before](evidence/before/dashboard.png) | [After](evidence/after/dashboard.png) |
| Executive dashboard | — | [Desktop](evidence/after/dashboard-executive-1920.png), [Mobile](evidence/after/dashboard-executive-390.png) |
| Privacy dashboard | — | [Desktop](evidence/after/dashboard-privacy-1920.png), [Mobile](evidence/after/dashboard-privacy-390.png) |
| Personal dashboard | — | [Desktop](evidence/after/dashboard-personal-1920.png), [Mobile](evidence/after/dashboard-personal-390.png) |
| Login | — | [390px](evidence/after/login-390.png), [768px](evidence/after/login-768.png), [1440px](evidence/after/login-1440.png) |

The evidence/after directory additionally includes Dark mode, collapsed sidebar, mobile tickets and validation dialogs at 120% font scaling. Committed login visual baselines were refreshed to the actual final screenshots.

## Verification actually run

| Check | Result |
|---|---|
| Web TypeScript and ESLint | Passed; final checks rerun after JSX edits |
| Web Vitest | 89 files, 559 tests passed |
| Web production build | Passed with isolated local dummy public configuration |
| API build | Existing script's Wrangler dry-run passed; no upload |
| Build budget | Passed: entry JS 99.8/120 KiB, CSS 25.7/30 KiB, largest lazy JS 209.0/210 KiB, largest asset 1.21/1.35 MiB, API 1.20/1.50 MiB |
| Initial browser regression | 55 passed: aurora, fullhd-spacing, shell-navigation, ux-system, print-typography, public-surfaces |
| Module/detail regression | 57 passed, 1 outdated CSS-class assertion failed; corrected to assert semantic data-variant |
| Final production-preview regression | 53 passed: enterprise-theme, aurora, fullhd-spacing, tickets-ux including the corrected queue case |
| Dashboard/system/contrast | 10 passed: 4 API summary modes at 390/1920 plus OS theme changes and normal/hover primary button contrast |
| Login accessibility/visual gate | 3 passed at 390/768/1440 |
| Final selected-menu verification | 17 passed after the last CSS edit: desktop Light/Dark with both sidebar states, all dashboard modes, System mode and contrast |

Nine viewports: 1920×1080, 1600×900, 1440×900, 1366×768, 1280×800, 1024×768, 768×1024, 390×844, 375×812. Ticket layout tests cover Light/Dark × expanded/collapsed and validation dialogs at 120%; density tests cover all three settings, persistence and favorites. Keyboard tests cover mobile focus containment/restoration and desktop controls. Print typography test verifies A4 font metrics, page breaks and signatures. Save-failure tests retain form drafts.

Reproduce from repository root with installed lockfile dependencies and isolated local public configuration:

```powershell
npm run typecheck --workspace=apps/web
npm run lint --workspace=apps/web
npm run test --workspace=apps/web
npm run build --workspace=apps/web
npm run build --workspace=apps/api # includes --dry-run
npm run budget
cd apps/web
npx playwright test enterprise-theme.spec.ts aurora.spec.ts fullhd-spacing.spec.ts tickets-ux.spec.ts --project=chromium
npx playwright test fullhd-modules.spec.ts detail-popups.spec.ts shell-navigation.spec.ts ux-system.spec.ts print-typography.spec.ts public-surfaces.spec.ts --project=chromium
npx playwright test quality-gates.spec.ts --project=quality-390 --project=quality-768 --project=quality-1440
```

## Findings and remaining verification

- Fixed an intermediate JSX closing-tag error before rerunning checks. The final typecheck, lint and browser runs passed.
- Updated the existing queue test because it asserted a blue utility class; it now checks the primary variant while retaining all URL/filter behavior assertions.
- The shared local dependency tree initially lacked @cloudflare/playwright. Restored version 1.3.5 already recorded in the base lockfile into the isolated worktree dependency directory; the API dry-run and budget then passed. No manifest or lockfile changed.
- Largest lazy bundle is near its existing budget (209/210 KiB). No dependency was added by this redesign.
- Live staging API workflows, real role/RLS enforcement, authentication/MFA, production PDF generation and every successful module detail/create/export journey were not run against real services. No claim of live UAT is made. Module-wide checks use recoverable service-error fixtures; dashboard mode tests validate rendering of supplied summaries, not server authorization.
- Full cross-engine WebKit and complete all-route accessibility certification remain follow-up review work.

## Changed files

- `apps/web/e2e/__screenshots__/quality-gates.spec.ts/login-quality-1440.png`
- `apps/web/e2e/__screenshots__/quality-gates.spec.ts/login-quality-390.png`
- `apps/web/e2e/__screenshots__/quality-gates.spec.ts/login-quality-768.png`
- `apps/web/e2e/tickets-ux.spec.ts`
- `apps/web/src/components/shell/Sidebar.tsx`
- `apps/web/src/components/shell/Topbar.tsx`
- `apps/web/src/components/table/DataTable.tsx`
- `apps/web/src/components/ui/Button.tsx`
- `apps/web/src/components/ui/Card.tsx`
- `apps/web/src/components/ui/FilterBar.tsx`
- `apps/web/src/components/ui/KpiStrip.tsx`
- `apps/web/src/components/ui/PageTitle.tsx`
- `apps/web/src/index.css`
- `apps/web/src/layouts/AppShell.tsx`
- `apps/web/src/pages/HomePage.tsx`
- `apps/web/src/styles/system.css`
- `apps/web/tailwind.config.js`
- `apps/web/e2e/enterprise-theme.spec.ts` (new)
- `docs/ui-redesign/` (inventory, report and synthetic evidence)

## Isolation and review

The original working directory contained unrelated uncommitted API/PDF/auth changes. This work was created in a separate git worktree at `.tmp/cloudflare-redesign` from current origin/master and does not include or alter those pending changes. Only presentation sources, UI tests, visual baselines and documentation belong to this change. No backend, API contract, permissions, authentication/MFA, RLS, schema, migration or CI pipeline changes are included. No merge or production deployment was performed. Draft review and staging UAT remain required before release.
