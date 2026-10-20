# Frontend Architecture

## 1. Design goals

Build an analyst-focused security console. Optimize for fast triage, clear evidence, stable filters, keyboard-friendly workflows, and large event tables—not merely visual decoration.

## 2. Stack

- Next.js App Router.
- React and TypeScript.
- Tailwind CSS.
- shadcn/ui or the existing accessible component system.
- TanStack Query for client-side server state where useful.
- React Hook Form and Zod for forms.
- ECharts or Recharts for charts.
- SSE for scoped one-way notifications.

Inspect the existing repository and use compatible versions rather than blindly replacing dependencies.

## 3. Route structure

Suggested routes:
- `/login`
- `/dashboard`
- `/events`
- `/events/[eventId]`
- `/alerts`
- `/alerts/[alertId]`
- `/incidents`
- `/incidents/[incidentId]`
- `/assets`
- `/assets/[assetId]`
- `/detection-rules`
- `/detection-rules/new`
- `/detection-rules/[ruleId]`
- `/event-sources`
- `/audit-logs`
- `/settings/members`
- `/settings/organization`

Use a shared authenticated application shell, but keep domain pages modular.

## 4. Component boundaries

Organize by domain, for example:
- `features/events`
- `features/alerts`
- `features/incidents`
- `features/assets`
- `features/detection-rules`
- `features/organizations`
- `features/audit`

Each feature should own its page components, query hooks, schemas, and reusable UI where practical. Keep API calls in a typed API layer rather than scattered through components.

## 5. Rendering and state

- Use Server Components for appropriate initial page rendering and non-interactive layout.
- Use Client Components for forms, charts, interactive tables, local UI state, and SSE.
- Use URL parameters for shareable filters and pagination where appropriate.
- Use server-side validation for all query filters.
- Do not expose server secrets or privileged tokens to client bundles.
- Avoid making the entire app a Client Component without a clear reason.

## 6. Event explorer

Must support:
- Time range.
- Event type.
- Severity.
- Source.
- Asset/user filters where permitted.
- Stable sorting.
- Bounded pagination.
- Row virtualization when useful.
- Event detail view.
- Related alert/incident navigation.
- Saved queries as a later increment.

Do not load all events into browser memory. Debounce search inputs and cancel obsolete requests when possible.

## 7. Dashboard

Display:
- Event volume over time.
- Active incidents by severity/status.
- Alert counts and trends.
- Recent detections.
- Asset overview.
- Ingestion/processing health for authorized operators.

Use precomputed or cached aggregates where needed. Avoid expensive unbounded queries on every page load. Clearly distinguish security data from system-health metrics.

## 8. Incident workspace

Show:
- Incident summary and status.
- Severity and explainable priority factors.
- Assignment.
- Related alerts and events.
- Timeline.
- Notes and evidence.
- Audit-relevant actions.
- AI explanation and suggestions, when enabled.

Display observed facts separately from AI hypotheses. Provide evidence references and allow analysts to inspect the source records.

## 9. Real-time updates

Use SSE initially for alert and incident notifications. Keep payloads small and organization-scoped. On receiving a notification, update relevant counters or refetch the authoritative resource. Do not stream every raw event to every browser.

Handle reconnects, duplicate notifications, expired sessions, revoked memberships, and server restarts.

## 10. Accessibility and usability

- Use semantic headings and controls.
- Provide keyboard navigation and visible focus.
- Do not encode severity by color alone.
- Include loading, empty, error, and permission-denied states.
- Confirm destructive or high-impact actions.
- Preserve search filters when navigating back from a detail page.
- Use readable timestamps and clearly identify the display timezone.

## 11. Frontend tests

- Component tests for filters, forms, and state transitions.
- API error handling.
- Unauthorized/forbidden states.
- Pagination and sorting.
- SSE reconnect behavior.
- Critical end-to-end analyst workflow.
- Accessibility checks for core pages.
