# Architecture Decisions and Open Questions

## ADR-001: Modular monolith first

**Status:** Accepted for initial implementation.

**Context:** The platform has several domains, but early microservices would add operational and consistency complexity before workload boundaries are known.

**Decision:** Use a modular NestJS application plus separately deployable event and background workers. Keep explicit domain boundaries.

**Consequences:** Easier local development and testing; modules must avoid circular dependencies. Extract services later only with a clear scaling or ownership reason.

## ADR-002: PostgreSQL as the initial source of truth

**Status:** Accepted for initial implementation.

**Context:** The project needs relational integrity, tenant scoping, transactional workflows, and event filtering.

**Decision:** Use PostgreSQL for core data and initial event search. Use indexes and query plans before adding another database.

**Revisit when:** Measured search latency, indexing workload, or query requirements justify OpenSearch or another specialized system.

## ADR-003: Redis Streams for initial event transport

**Status:** Accepted provisionally.

**Context:** The initial event pipeline needs asynchronous consumers without introducing a large broker operating burden.

**Decision:** Use Redis Streams for event transport, with a transactional outbox and idempotent consumers. Use BullMQ for application background jobs.

**Revisit when:** Sustained throughput, durable replay, transport retention, or consumer requirements exceed the design's verified capability.

## ADR-004: Transactional outbox

**Status:** Accepted.

**Context:** Writing to PostgreSQL and publishing to a queue are two separate operations and can fail independently.

**Decision:** Write event and outbox record in one database transaction; publish asynchronously; tolerate duplicate publication through idempotent consumers.

**Consequences:** Adds publisher and cleanup logic, but reduces silent-loss risk.

## ADR-005: Deterministic detection; advisory AI

**Status:** Accepted.

**Context:** Security detections need repeatability and evidence. LLM outputs can be wrong or manipulated by untrusted event text.

**Decision:** Deterministic rules create matches and alerts. The LLM explains evidence and suggests read-only investigation steps. It does not authorize or execute remediation.

## ADR-006: SSE before WebSockets

**Status:** Accepted provisionally.

**Context:** Initial real-time needs are primarily server-to-browser notifications.

**Decision:** Use SSE with scoped subscriptions and reconnection behavior.

**Revisit when:** Requirements need bidirectional, low-latency communication that SSE cannot satisfy.

## ADR-007: RLS plus application authorization

**Status:** Accepted.

**Context:** Tenant isolation is a critical security boundary.

**Decision:** Enforce authorization in application services and use PostgreSQL RLS as defense in depth. Use transaction-scoped tenant context and non-bypass application DB roles.

**Consequences:** Requires careful pool handling and comprehensive tests for API and worker access paths.

## ADR-008: No premature Kubernetes or OpenSearch

**Status:** Accepted for initial implementation.

**Context:** Operational complexity should be proportional to demonstrated need.

**Decision:** Use Docker Compose locally and a simple production deployment topology initially. Add specialized infrastructure when measured requirements justify it.

## Open questions to resolve during Phase 0

1. Will authentication use a managed OIDC provider or an established application library?
2. Is organization membership single-role or multi-role per user?
3. Is email unique globally or only within an organization?
4. What event sources and normalized event types are supported in the first demo?
5. What is the exact partial-batch acceptance behavior?
6. What are the source credential format, rotation flow, and revocation behavior?
7. What is the first supported rule configuration schema?
8. Which incident transitions require a reason or elevated permission?
9. Which event fields may contain personal or sensitive information?
10. What retention defaults apply to events, incidents, audit, evidence, and AI outputs?
11. What object-storage provider or local emulator will be used?
12. Which LLM provider is available, and what data may be sent to it?
13. What hardware/cloud budget is available for load testing?
14. What benchmark dataset size and event distribution will be used?
15. What is the chosen production deployment environment?
16. What RPO/RTO targets can the selected infrastructure actually support?

Resolve questions only when they affect the current phase. Document assumptions rather than blocking all progress on future decisions.
