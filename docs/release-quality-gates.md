# Release quality gates

The repository enforces the following checks before a production release:

- `npm run test:coverage` runs script, API, web, migration, shared-package, and Supabase tests. API and web coverage thresholds prevent regressions below the current baseline, with higher thresholds for critical middleware, services, hooks, and utilities.
- `npm run build` creates the production API Worker and web bundles.
- `npm run budget` checks gzip limits for the web entry bundle, CSS, lazy chunks, static assets, and API Worker.
- `npm run test:e2e` runs the local browser regression suite.
- `npm run audit:prod` rejects known production dependency vulnerabilities.

The Staging Live E2E workflow provisions disposable accounts for requester, technician, approver, manager, administrator, and vendor journeys. It cleans those records up after the serial test suite, so permanent UAT credentials are not required. The workflow still requires the staging Supabase URL, anonymous key, service-role key, and Turnstile test configuration.

The Production Health Monitor runs every 15 minutes and can also be started manually. It verifies the web shell, API liveness, database readiness, and response-time objectives. A failed run opens or updates a GitHub issue titled `[monitor] Production health check failed`; the next successful run closes that issue. The monitor reads repository variables instead of the `production` environment, because that environment requires a reviewer and every scheduled run would otherwise wait for a manual approval.

Required variables:

- `PRODUCTION_WEB_URL` — repository variable for the monitor, environment variable for the deploy workflow
- `PRODUCTION_API_URL` — repository variable for the monitor, environment variable for the deploy workflow

Optional overrides:

- `SLO_WEB_MAX_MS` (default: `3000`)
- `SLO_API_LIVE_MAX_MS` (default: `1500`)
- `SLO_API_READY_MAX_MS` (default: `3000`)
- `SLO_DATABASE_MAX_MS` (default: `1500`)
- `HEALTHCHECK_ATTEMPTS` (default: `3`)
- `HEALTHCHECK_TIMEOUT_MS` (default: `8000`)

Run the same production probe locally with `npm run health:production` after setting the two required URLs.

Backup and restore workflows are outside these release-quality changes and retain their existing behavior.
