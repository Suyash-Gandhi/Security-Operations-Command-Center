# API Contracts and Conventions

## 1. General conventions

- Prefix APIs with `/v1`.
- Use JSON unless the endpoint explicitly handles file uploads or streams.
- Document contracts in OpenAPI.
- Validate request parameters, bodies, and external payloads at runtime.
- Return consistent error structures.
- Use stable identifiers and bounded pagination.
- Include a request/correlation ID in logs and error responses.
- Do not expose stack traces, SQL details, secrets, or sensitive payloads.
- Apply authentication, organization scope, and resource-level authorization to every protected endpoint.

## 2. Suggested endpoint catalogue

These endpoints are an initial contract proposal; refine them to fit the implementation and document every final route in OpenAPI.

### Identity and organizations
- `POST /v1/auth/login` — if login is handled by the application.
- `POST /v1/auth/logout`
- `GET /v1/organizations/current`
- `GET /v1/organizations/current/members`
- `POST /v1/organizations/current/members`
- `PATCH /v1/organizations/current/members/:membershipId`

If an OIDC provider manages authentication, follow its supported flow rather than building a parallel password system.

### Assets and sources
- `GET /v1/assets`
- `POST /v1/assets`
- `GET /v1/assets/:assetId`
- `PATCH /v1/assets/:assetId`
- `GET /v1/event-sources`
- `POST /v1/event-sources`
- `POST /v1/event-sources/:sourceId/rotate-credential`
- `PATCH /v1/event-sources/:sourceId/status`

### Ingestion and events
- `POST /v1/events/ingest`
- `POST /v1/events/imports`
- `GET /v1/event-batches/:batchId`
- `GET /v1/events`
- `GET /v1/events/:eventId`

### Detection and alerts
- `GET /v1/detection-rules`
- `POST /v1/detection-rules`
- `GET /v1/detection-rules/:ruleId`
- `PATCH /v1/detection-rules/:ruleId`
- `POST /v1/detection-rules/:ruleId/test`
- `GET /v1/alerts`
- `GET /v1/alerts/:alertId`
- `POST /v1/alerts/:alertId/assign`
- `POST /v1/alerts/:alertId/transitions`

### Incidents
- `GET /v1/incidents`
- `POST /v1/incidents`
- `GET /v1/incidents/:incidentId`
- `POST /v1/incidents/:incidentId/assign`
- `POST /v1/incidents/:incidentId/transitions`
- `POST /v1/incidents/:incidentId/notes`
- `POST /v1/incidents/:incidentId/evidence`
- `GET /v1/incidents/:incidentId/timeline`
- `POST /v1/incidents/:incidentId/explanation`

### Audit and operations
- `GET /v1/audit-logs`
- `GET /v1/notifications`
- `GET /v1/notifications/:notificationId`
- `GET /v1/stream` — SSE endpoint if implemented and secured.

## 3. Query and pagination rules

- Enforce a maximum page size.
- Use cursor-based pagination for high-volume event data where appropriate.
- Validate sort fields against an allowlist.
- Validate time ranges and impose maximum query windows for expensive searches.
- Never interpolate user input into raw SQL.
- Ensure all filters are organization-scoped.
- Do not expose existence of another tenant's records through distinguishable error details.

## 4. Error handling

Define a consistent error body with fields such as:
- `code`: stable machine-readable code.
- `message`: safe user-facing message.
- `requestId`: correlation identifier.
- `details`: optional validated field errors, without sensitive values.

Use suitable status codes, for example:
- `400` invalid request.
- `401` unauthenticated.
- `403` authenticated but not authorized, where disclosure is appropriate.
- `404` missing resource or deliberately concealed unauthorized resource.
- `409` idempotency conflict or state conflict.
- `413` payload too large.
- `429` rate limit.
- `503` temporary inability to accept work.

Choose a consistent resource-concealment policy for cross-tenant IDs and apply it everywhere.

## 5. Ingestion semantics

Document:
- Authentication method.
- Maximum payload and batch size.
- Idempotency key behavior.
- Partial batch semantics.
- Response acceptance semantics.
- Retryable error codes.
- Batch status lifecycle.
- Event schema version.
- Rate and quota limits.

A success response means durable acceptance only, not completed detection processing.

## 6. Authorization requirements

For each endpoint document:
- Required authentication.
- Required permission.
- Organization scope.
- Resource-level ownership check.
- Allowed state transitions.
- Audit behavior.
- Rate limits.
- Whether the operation is idempotent.

## 7. SSE contract

SSE must:
- Authenticate the connection.
- Scope subscriptions to the authorized organization and permitted event types.
- Avoid sending raw event payloads by default.
- Reauthorize or safely terminate connections when membership/session access is revoked.
- Support reconnect behavior and event IDs where useful.
- Avoid relying on the browser as the source of truth; notifications should prompt a fetch of authoritative data.

## 8. Contract tests

Generate or maintain tests from OpenAPI where feasible. Verify request validation, response shape, error behavior, authentication, authorization, pagination, and tenant isolation.
