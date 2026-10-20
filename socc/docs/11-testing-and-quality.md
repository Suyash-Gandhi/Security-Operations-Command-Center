# Testing and Quality Strategy

## 1. Testing layers

### Unit tests
Test normalization, rule evaluation, threshold boundaries, incident correlation, state transitions, priority calculation, permission evaluation, and idempotency-key logic.

### Integration tests
Test PostgreSQL repositories, migrations, RLS policies, outbox publishing, Redis Streams consumers, BullMQ jobs, object-storage authorization, and notification retries.

### Contract tests
Verify OpenAPI request/response schemas, validation errors, auth requirements, pagination, and stable error codes.

### End-to-end tests
Verify full workflows through the UI and API using synthetic data.

### Load tests
Measure event ingestion, searches, dashboard, incident updates, SSE, and mixed workloads.

### Security tests
Test cross-tenant access, broken object-level authorization, privilege escalation, CSRF where relevant, SSRF, rate limits, injection, uploads, session revocation, prompt injection, and secrets/dependency scans.

## 2. Critical end-to-end scenarios

### Scenario A — Detection
1. Register a test source.
2. Submit synthetic failed-login events.
3. Verify durable acceptance and batch status.
4. Wait for processing.
5. Verify the expected threshold rule matched.
6. Verify an alert includes supporting event references and rule version.
7. Verify incident creation or correlation.
8. Verify an authorized analyst can inspect and resolve the incident.
9. Verify audit records.

### Scenario B — Tenant isolation
1. Create organizations A and B.
2. Create separate members, sources, assets, events, alerts, and incidents.
3. Authenticate as a user in B.
4. Attempt direct ID access, search, export, SSE subscription, and AI explanation for A's records.
5. Verify no protected data is disclosed or modified.
6. Test the application DB role directly against RLS policies.

### Scenario C — Duplicate delivery
1. Submit an event with a stable source event ID.
2. Submit it again.
3. Simulate queue duplicate delivery.
4. Verify the configured deduplication policy.
5. Verify no unintended duplicate alert, incident, audit side effect, or notification.

### Scenario D — Failure recovery
1. Commit an event/outbox record.
2. Make Redis unavailable before publication.
3. Restore Redis.
4. Verify publication resumes.
5. Crash a worker after a side effect but before acknowledgement.
6. Verify retry is safe and processing converges.

### Scenario E — AI safety
1. Create an incident with authorized evidence.
2. Include malicious prompt-like text in one synthetic event.
3. Request an explanation as an authorized analyst.
4. Verify the output remains advisory and references only retrieved evidence.
5. Request the same incident from another tenant and verify denial.
6. Simulate provider timeout and verify core features remain available.

## 3. Test data

Use synthetic fixtures with stable IDs and reproducible timestamps. Include normal activity, suspicious scenarios, malformed data, duplicates, late events, high-volume bursts, and cross-tenant records. Never commit real customer logs or secrets.

## 4. Quality gates

For every pull request:
- Format and lint.
- Typecheck.
- Run unit tests.
- Run relevant integration tests.
- Validate migrations.
- Run authorization/tenant tests for affected modules.
- Scan dependencies and secrets.
- Build application and workers.
- Run critical end-to-end tests when feasible.

## 5. Flaky tests and skipped tests

Do not hide failures by weakening assertions or skipping tests without explanation. If a test is flaky, isolate the cause and document the remediation. Report exact commands and actual results.

## 6. Detection metrics

On labeled synthetic data, calculate:
- True positives.
- False positives.
- True negatives.
- False negatives.
- Precision.
- Recall.
- Alerts per scenario.

Explicitly state that metrics describe the test dataset and do not establish real-world detection accuracy.

## 7. Definition of test completion

A feature is not done merely because it works manually once. It needs automated coverage for important behavior, negative cases, authorization, error handling, and relevant failure conditions.
