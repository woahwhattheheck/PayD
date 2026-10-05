# Backend Sentry setup

The backend reports unhandled process errors through `@sentry/node` and explicitly captures Express errors with the PayD request ID, authenticated user ID (when present), route pattern, HTTP method, and error type.

Request bodies, query strings, cookies, `Authorization`, `Cookie`, and `Set-Cookie` headers are removed before an event is sent.

## Runtime configuration

Set these on the backend service:

- `SENTRY_DSN` — backend project DSN. If omitted, reporting is disabled.
- `SENTRY_ENVIRONMENT` — optional environment name; falls back to `NODE_ENV`.
- `SENTRY_RELEASE` — optional deployed version/commit identifier.

Performance monitoring and profiling are intentionally not enabled by this integration.

## Source maps

TypeScript already emits source maps. `npm run build` runs the source-map upload step after `tsc`.

The upload runs only when all three CI/deploy-only variables are present:

- `SENTRY_AUTH_TOKEN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`

The auth token is only a build/deploy credential; do not expose it to the running application. The upload injects Sentry debug IDs into `dist` and uploads the generated JavaScript and source maps.

## Alert rule

In the backend Sentry project, create or enable an Issue Alert with the **A new issue is created** condition and route it to the production on-call destination. Captured Express errors include an `error_type` tag, so the alert can be narrowed by error class if needed.

This account-side alert rule cannot be stored in the application repository without a Sentry organization/project credential; the repository integration supplies the event grouping and tags the rule consumes.
