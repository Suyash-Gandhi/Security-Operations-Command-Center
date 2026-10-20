# System Architecture

## 1. Architecture style

Use a **modular monolith plus separately deployable workers** for the initial implementation.

This preserves clear domain boundaries without the cost of operating many microservices. The API and workers may share domain libraries but run as separate processes and scale independently.

## 2. Recommended stack

- Frontend: Next.js App Router, React, TypeScript, Tailwind CSS, shadcn/ui.
- Client data: TanStack Query where useful; URL search parameters for shareable filters.
- Forms: React Hook Form and Zod.
- Backend: NestJS and TypeScript.
- API contracts: OpenAPI.
- Database: PostgreSQL.
- ORM: Prisma.
- Queue transport: Redis Streams for the initial event pipeline.
- Background jobs: BullMQ for imports, notifications, reports, and scheduled tasks.
- Object storage: S3-compatible storage for evidence and exports.
- Real-time delivery: Server-Sent Events (SSE) for scoped alert/incident notifications.
- AI: external LLM API behind a dedicated provider abstraction.
- Local environment: Docker Compose.
- Observability: OpenTelemetry, Prometheus, Grafana, and an error tracker as appropriate.
- CI: GitHub Actions or the repository's existing CI provider.

Check current package versions and compatibility before implementation. Do not upgrade or replace existing dependencies without reviewing the repository.

## 3. Logical architecture

```text
Analyst Browser
   |
   v
Next.js Web App
   |
   | HTTPS / SSE
   v
Edge / Load Balancer / WAF
   |
   v
NestJS API
   |---- Identity and Organization
   |---- Asset Management
   |---- Event Ingestion
   |---- Event Search
   |---- Detection Rule Management
   |---- Alert and Incident Management
   |---- AI Investigation API
   |---- Audit API
   |
   +---- PostgreSQL (source of truth)
   +---- Redis
   +---- Object Storage
   |
   v
Transactional Outbox Publisher
   |
   v
Redis Streams
   |
   v
Event Workers
   |---- Validate / Normalize
   |---- Enrich
   |---- Deduplicate
   |---- Evaluate Detection Rules
   |---- Create / Update Alerts
   |---- Correlate Incidents
   |
   +---- Background Job Workers
   |       |---- Imports
   |       |---- Notifications
   |       |---- Reports
   |       |---- Retention tasks
   |
   +---- Observability
```

This diagram is logical. Do not deploy every module as a separate service by default.

## 4. Domain boundaries

- Identity: authentication, sessions, memberships, permissions.
- Organizations: tenant settings and organization lifecycle.
- Assets: asset inventory and classification.
- Ingestion: source authentication, request validation, batch acceptance.
- Event processing: normalization, enrichment, deduplication.
- Detection: rule configuration, evaluation, suppression, match evidence.
- Alerts: individual detection results and alert lifecycle.
- Incidents: correlation, assignment, investigation, notes, evidence, transitions.
- Search: event queries, saved searches, aggregates.
- Notifications: delivery, retries, preferences.
- AI investigation: authorized evidence retrieval and LLM orchestration.
- Audit: security-sensitive action history.

Modules should communicate through explicit application services or events rather than circular dependencies.

## 5. Data ownership and source of truth

PostgreSQL is authoritative for organizations, users/memberships, assets, rules, events, alerts, incidents, and audit records. Redis is not the sole source of truth for accepted events or important incident state. Object storage holds large evidence objects and exports; the database stores references and metadata.

Search indexes and caches, if added, are derived systems and must be rebuildable or reconciled.

## 6. Event durability and outbox

Use a transactional outbox where event acceptance writes the event and an outbox record in one PostgreSQL transaction. A publisher sends pending outbox messages to Redis Streams and marks them published. Publishing may occur more than once if the publisher crashes after sending; consumers must be idempotent.

Do not claim exactly-once delivery. Design for at-least-once delivery with idempotent side effects.

## 7. Redis responsibilities

Use Redis Streams for event transport and consumer groups. Use BullMQ for application jobs. Redis may also support cache entries, rate-limit counters, and short-lived coordination state. Define TTLs, memory limits, persistence, and recovery expectations.

Do not use one queue abstraction for every purpose without clear ownership and retry policies.

## 8. Scaling boundaries

Scale API instances horizontally when request load requires it. Scale event workers based on queue lag and processing throughput. Scale job workers independently. Avoid unlimited database connections from each replica. Add connection pooling and monitor saturation.

Consider extracting ingestion or detection into separately deployed services only when independent scaling, deployment cadence, or failure isolation justifies the added complexity.

## 9. Future technology decision triggers

- OpenSearch: consider when PostgreSQL query patterns, full-text requirements, or event-search latency justify a dedicated index.
- Kafka or managed durable log: consider when sustained throughput, replay, retention, and consumer needs exceed the initial Redis Streams design.
- Kubernetes: consider when deployment complexity and workload needs justify it; it is not a prerequisite.
- Read replicas: consider when measured read load saturates the primary and replica lag is acceptable.
- Graph database: consider only if graph traversal workloads cannot be served adequately by relational relationships and purpose-built queries.

## 10. Architectural invariants

- All tenant-owned operations have trusted tenant context.
- No unbounded query or ingestion payload is accepted.
- No event is acknowledged as durably accepted before durable storage.
- Retryable processing is idempotent.
- AI calls are not on the critical path for ingestion or detection.
- Search indexes and caches do not become the authoritative incident state.
- Operational metrics expose queue lag, errors, latency, and saturation.
