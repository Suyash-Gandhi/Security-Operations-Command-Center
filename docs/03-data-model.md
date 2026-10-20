# Data Model and Database Design

## 1. General conventions

- Use PostgreSQL as the source of truth.
- Use UUID identifiers unless the existing repository has a justified identifier convention.
- Store timestamps as timezone-aware values and operate consistently in UTC.
- Use explicit foreign keys and database constraints for important invariants.
- Use migrations for every schema change.
- Include `organization_id` on tenant-owned records where appropriate.
- Keep large binary files in object storage.
- Use JSONB for source-specific or evolving fields, not as a replacement for relational modeling.
- Define retention and deletion behavior for every data category.

## 2. Core entities

### Identity and tenancy
- `organizations`: id, name, status, created_at, updated_at.
- `users`: id, normalized_email, display_name, status, created_at, updated_at.
- `organization_memberships`: id, organization_id, user_id, status, created_at.
- `roles`, `permissions`, `role_permissions`, `membership_roles`: role/permission mappings scoped according to the authorization design.
- Session and identity-provider data should follow the selected authentication integration's requirements.

A user may belong to more than one organization. Define whether email uniqueness is global or tenant-specific before implementing login.

### Assets and sources
- `assets`: id, organization_id, name, asset_type, hostname, environment, criticality, owner reference, status, last_seen_at, created_at, updated_at.
- `event_sources`: id, organization_id, name, source_type, credential reference/hash as appropriate, status, last_event_at, created_at, updated_at.

Never store a source secret in plaintext for later retrieval. If verification requires a secret, design the credential scheme so plaintext is not recoverable where possible.

### Events and ingestion
- `event_batches`: id, organization_id, source_id, status, accepted_count, rejected_count, processed_count, created_at, completed_at, error_summary.
- `security_events`: id, organization_id, source_id, event_type, event_time, received_at, source_event_id, schema_version, actor reference, asset reference, severity, normalized_payload, raw_payload_reference, created_at.
- `outbox_messages`: id, aggregate_type, aggregate_id, message_type, schema_version, payload, created_at, published_at, attempt_count, last_error.
- `idempotency_records`: organization_id, idempotency_key, request_hash, resource_reference, created_at, expires_at.

The exact uniqueness strategy for source event IDs must account for partitioning. If events are partitioned by time, verify PostgreSQL's partitioned unique-index constraints before selecting the final key.

### Detection and alerts
- `detection_rules`: id, organization_id or platform scope, name, description, rule_type, configuration, severity, enabled, version, created_by, updated_at.
- `detection_matches`: id, organization_id, rule_id, rule_version, match_key, matched_at, evidence metadata.
- `alerts`: id, organization_id, rule_id, severity, status, title, description, first_seen_at, last_seen_at, asset_id, primary_event_id, incident_id nullable, created_at, updated_at.
- `alert_events`: alert_id, event_id, relationship_type, created_at.

Define whether a detection match updates an existing alert or creates a new alert. Make the policy deterministic and testable.

### Incidents
- `incidents`: id, organization_id, title, description, severity, priority, status, assigned_to, created_at, updated_at, resolved_at, closed_at.
- `incident_alerts`: incident_id, alert_id, linked_at, linked_by.
- `incident_notes`: id, organization_id, incident_id, author_id, content, created_at.
- `incident_evidence`: id, organization_id, incident_id, evidence_type, object_reference, checksum, uploaded_by, created_at.
- `incident_timeline`: id, organization_id, incident_id, event_type, actor_id, details, occurred_at, created_at.

Use explicit join tables rather than embedding unbounded alert/event lists in incident JSON.

### Audit and notifications
- `audit_logs`: id, organization_id nullable only for legitimate global actions, actor_id, action, resource_type, resource_id, occurred_at, request_id, metadata.
- `notification_deliveries`: id, organization_id, notification_type, destination_reference, status, attempt_count, next_attempt_at, last_error, created_at, updated_at.
- `saved_searches`: id, organization_id, owner_id, name, validated_query_definition, created_at, updated_at.

## 3. Relationship rules

- Every tenant-owned record belongs to exactly one organization unless a clearly documented global/platform record exists.
- Related records must belong to the same organization.
- Enforce organization consistency in application services and, where practical, with database constraints or RLS.
- A user reference does not prove membership; authorization must validate membership.
- Alert-to-event and incident-to-alert relationships must not cross organizations.
- Background jobs must carry or resolve a trusted organization context.

## 4. Initial indexes to evaluate

Create indexes based on query plans and measured workload, not by blindly creating every candidate.

Candidates:
- Membership lookup by `(organization_id, user_id)` and user lookup by normalized email.
- Assets by `(organization_id, status)` and hostname/name where useful.
- Events by `(organization_id, event_time DESC, id)` for time-bounded browsing.
- Events by `(organization_id, event_type, event_time DESC)` for common event-type filters.
- Alerts by `(organization_id, status, severity, created_at DESC)`.
- Incidents by `(organization_id, status, priority, updated_at DESC)`.
- Incident-alert join keys in both lookup directions.
- Outbox records by publication status and creation time.
- Notification jobs by status and next attempt time.

Use `EXPLAIN (ANALYZE, BUFFERS)` on representative data before deciding that an index is beneficial.

## 5. Partitioning and retention

Start without partitioning unless expected volume or retention operations already justify it. Design for future range partitioning of `security_events` by `event_time`.

Before partitioning, resolve:
- Primary and unique key constraints.
- Deduplication constraints.
- Foreign-key limitations.
- Partition granularity.
- Late-arriving events.
- Retention deletion strategy.
- Index creation and maintenance.
- Query plans across partitions.

Use partition removal for expiry when appropriate; do not delete millions of rows in one unbounded transaction.

## 6. Data integrity

- Use transactions for incident transitions, alert links, and audit writes where consistency requires them.
- Use optimistic concurrency or version fields for records that can be updated concurrently.
- Add uniqueness constraints for idempotency.
- Avoid storing credentials, tokens, or unnecessary sensitive payloads in event JSON.
- Store checksums for evidence objects and verify them when needed.
- Document which audit/evidence records are append-only and how corrections are represented.

## 7. Migrations

Every schema change must include a migration and rollback/recovery notes. Prefer additive, backward-compatible changes. Never reset production or existing user data to apply a schema change. Seed data must be explicitly development/test-only.
