# Roadmap and Acceptance Criteria

## Phase 0 — Discovery and architecture
Deliver:
- Repository audit.
- PRD review.
- Architecture and data-flow diagrams.
- Threat model.
- Domain boundaries.
- Initial ADRs.
- Open questions and implementation plan.

Acceptance: the plan matches the repository and the user approves the first implementation phase. No major application feature work yet.

## Phase 1 — Foundation and tenant security
Deliver:
- App structure and validated configuration.
- PostgreSQL/Prisma migrations.
- Authentication integration.
- Organizations and memberships.
- Authorization primitives.
- Tenant context and RLS policies.
- Structured logging and error handling.
- CI checks.

Acceptance: users can authenticate and automated tests demonstrate isolation across two organizations.

## Phase 2 — Assets and event ingestion
Deliver:
- Assets and event sources.
- Authenticated REST ingestion.
- Event schema and validation.
- Batch import and status.
- Durable event acceptance and outbox.
- Redis Streams publication and consumers.
- Idempotency and metrics.

Acceptance: synthetic events survive tested publication/worker failure and duplicate deliveries do not create unintended side effects.

## Phase 3 — Detection engine
Deliver:
- Constrained rule schema.
- Threshold rules.
- Versioning.
- Match evidence.
- Suppression and alert grouping.
- Deterministic test fixtures.

Acceptance: known scenarios produce expected alerts with reproducible evidence and safe retries.

## Phase 4 — Incident management
Deliver:
- Alert/incident relationships.
- Correlation rules.
- Assignment and state machine.
- Notes and evidence references.
- Timeline and audit.
- Notification jobs.

Acceptance: analyst can investigate a synthetic incident end to end and the action history is auditable.

## Phase 5 — Frontend
Deliver:
- Command Center.
- Event explorer.
- Alert and incident queues.
- Asset views.
- Filters and pagination.
- SSE updates.
- Role-aware UI.

Acceptance: an analyst can navigate from overview to event evidence and incident resolution without unbounded data loading.

## Phase 6 — AI assistant
Deliver:
- Authorized evidence retrieval.
- LLM provider abstraction.
- Summary/explanation/recommendation workflow.
- Output schema and evidence-reference validation.
- Quotas, timeouts, and failure handling.

Acceptance: AI remains advisory, cannot bypass authorization, and provider failure does not affect detection.

## Phase 7 — Performance
Deliver:
- Reproducible load tests.
- Query profiling and optimization.
- Worker scaling and backpressure.
- Benchmark report.

Acceptance: actual results and limitations are published. Do not claim untested targets.

## Phase 8 — Advanced security intelligence
Deliver:
- Sequence detections.
- Rule simulator.
- Explainable prioritization.
- Attack timeline/graph.
- Labeled synthetic evaluation.

Acceptance: demonstrate a multi-event scenario with traceable evidence and documented evaluation metrics.

## Phase 9 — Production readiness
Deliver:
- Security scans and regression tests.
- Observability dashboards.
- Backup/restore exercise.
- Retention/deletion workflows.
- Deployment and runbooks.
- Final documentation and demo.

Acceptance: another developer can set up the project, run tests, reproduce the demo, and understand known limitations.

## Global definition of done

- Feature requirements met.
- Relevant tests pass or failures are explicitly documented.
- Authorization and tenant isolation tested.
- Migrations are safe and documented.
- Errors and retries are handled.
- Logs/metrics are sufficient for support.
- Documentation matches actual behavior.
- No unsupported claims of scale, compliance, or security.
