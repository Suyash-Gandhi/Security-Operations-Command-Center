# Big Pickle Implementation Guide

## Role

Act as the senior engineer implementing the Security Operations Command Center (SOCC). Use the documentation in this directory as the product and architecture specification. Your job is to implement a reliable, secure, testable project incrementally—not to generate a large amount of unverified code.

## First task: inspect before editing

Before changing any files:

1. Inspect the repository structure, package manager, existing code, framework versions, scripts, database setup, tests, and environment-variable conventions.
2. Identify what already exists and what is missing.
3. Read all documents in this directory.
4. Report a concise implementation plan, conflicts between the repository and docs, risks, and the first phase you propose to implement.
5. Do not overwrite working features or replace the stack without explaining why.
6. Do not assume any feature is complete merely because a file exists.

If the repository is empty, follow the stack and architecture in these docs. If it already has code, adapt the plan to preserve useful work.

## Implementation rules

- Implement only one roadmap phase at a time.
- Keep TypeScript strict; avoid `any` unless documented and justified.
- Use ES modules and modern JavaScript/TypeScript conventions.
- Validate all external inputs at runtime.
- Keep domain logic out of controllers and UI components.
- Use migrations for database changes. Never silently reset or drop existing data.
- Use transactions for multi-record invariants.
- Never expose secrets to the browser or commit secrets.
- Never trust client-supplied `organizationId` as authorization evidence.
- Enforce authorization in the backend. Use PostgreSQL RLS as defense in depth where configured.
- Use explicit tenant scope for workers and scheduled jobs.
- Make retryable background operations idempotent.
- Never return successful durable acceptance for an event that has not been durably stored or queued.
- The LLM must not be used to decide whether deterministic detection rules matched.
- AI suggestions must not execute remediation actions.
- Use synthetic fixtures only.
- Add tests for each behavior and security boundary.
- Update relevant docs when an implementation decision changes.
- Avoid adding infrastructure or dependencies without a concrete requirement.
- Do not introduce microservices, Kafka, Kubernetes, or OpenSearch in the initial build unless a measured or documented requirement demands it.

## Expected workflow for each phase

1. State the phase goal and acceptance criteria.
2. Inspect affected code and dependencies.
3. Propose the smallest safe implementation plan.
4. Implement the feature.
5. Run formatter, linter, typecheck, unit tests, integration tests, and relevant build checks.
6. Report exact commands run and results. Never claim tests passed if they were not run.
7. Explain any skipped checks and why.
8. List changed files and database migrations.
9. List security considerations and remaining risks.
10. Update documentation and provide a manual verification checklist.

## Phase gates

Do not start the next phase until the current phase meets its acceptance criteria or the user explicitly accepts documented gaps.

### Phase 0 — Discovery and architecture
Deliver a repository audit, implementation plan, domain boundaries, architecture decisions, and open questions. Do not write application features yet.

### Phase 1 — Foundation and tenant security
Set up app structure, configuration validation, database, migrations, authentication integration, organization membership, authorization primitives, and tenant-isolation tests.

### Phase 2 — Assets and event ingestion
Implement event-source authentication, validated ingestion, event schema, durable acceptance, transactional outbox, worker publication, idempotency, and batch status.

### Phase 3 — Detection engine
Implement constrained rule types, rule versioning, evaluation, suppression, alert creation, and deterministic test fixtures.

### Phase 4 — Incident management
Implement alert-to-incident relationships, correlation, lifecycle transitions, assignment, notes, evidence references, timeline, and audit events.

### Phase 5 — Analyst frontend
Implement dashboard, event explorer, alerts, incidents, assets, pagination, filters, and scoped real-time notifications.

### Phase 6 — AI assistant
Implement authorized evidence retrieval, data minimization, LLM integration, structured output validation, evidence references, quotas, and failure handling.

### Phase 7 — Performance
Add reproducible load tests, profile real bottlenecks, optimize queries and workers, and document measured results. Do not fabricate benchmark results.

### Phase 8 — Advanced capabilities
Add rule simulation, sequence detections, explainable prioritization, attack timeline/graph, and detection evaluation.

### Phase 9 — Production readiness
Complete security checks, backup/restore test, observability, deployment documentation, retention workflows, and final acceptance review.

## Definition of done

A phase is done only when:

- Its acceptance criteria are implemented.
- Relevant tests exist and pass, or any failures are explicitly documented.
- Tenant isolation and authorization are tested for affected endpoints.
- No known secrets or sensitive fixture data were introduced.
- Database changes have migrations and safe rollout notes.
- Error handling, logs, and metrics are adequate for the feature.
- Documentation reflects the actual implementation.
- The feature can be run and verified using documented steps.

## Reporting format

At the end of each phase, report:

- Summary
- Architecture decisions
- Files changed
- Migrations added
- Tests and exact results
- Security checks performed
- Known limitations
- Manual verification steps
- Recommended next phase

Do not implement all phases in one response. Start with Phase 0 and wait for approval before beginning Phase 1.
