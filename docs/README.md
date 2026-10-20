# Security Operations Command Center — Documentation Pack

This directory is the product and engineering specification for the Security Operations Command Center (SOCC), a multi-tenant security-event ingestion, detection, and incident-investigation platform.

## How to use this pack

1. Copy the `docs/` directory into the project repository.
2. Give `docs/00-big-pickle-implementation-guide.md` to Big Pickle first.
3. Ask Big Pickle to inspect the existing repository and report its plan before changing files.
4. Implement one phase at a time. Do not ask it to implement the entire system in one prompt.
5. Require tests, documentation updates, and a summary of changed files for every phase.
6. Treat all capacity numbers as targets to benchmark, not as existing capabilities or guarantees.

## Documents

| File | Purpose |
|---|---|
| `00-big-pickle-implementation-guide.md` | Instructions for the coding agent and phase gates |
| `01-product-requirements.md` | Product vision, users, scope, acceptance criteria |
| `02-system-architecture.md` | Architecture, boundaries, deployment shape, trade-offs |
| `03-data-model.md` | Core entities, relationships, tenant ownership, indexing |
| `04-event-ingestion-and-processing.md` | Ingestion contracts, outbox, idempotency, workers |
| `05-detection-and-incident-management.md` | Rules, alerts, correlation, incident lifecycle |
| `06-api-contracts.md` | API conventions and initial endpoint catalogue |
| `07-frontend-architecture.md` | Next.js application structure and interaction design |
| `08-security-and-threat-model.md` | Threats, controls, authorization, RLS, AI safety |
| `09-ai-assistant.md` | Safe LLM integration and evidence-grounded workflows |
| `10-scalability-and-performance.md` | Workload assumptions, optimization, benchmark plan |
| `11-testing-and-quality.md` | Testing pyramid, test scenarios, quality gates |
| `12-deployment-and-operations.md` | Environments, CI/CD, observability, recovery |
| `13-roadmap-and-acceptance.md` | Implementation phases and definition of done |
| `14-decisions-and-open-questions.md` | Initial ADRs and unresolved choices |

## Non-negotiable project principles

- Build a modular monolith with separately deployable workers first; do not begin with many microservices.
- PostgreSQL is the initial source of truth. Add OpenSearch or Kafka only when measured requirements justify them.
- Use deterministic rules for detection. The LLM is advisory and must not independently authorize or execute response actions.
- Every tenant-owned record and every background job must preserve organization scope.
- Accepted events must be durably recorded before the ingestion API reports success.
- Design for at-least-once message delivery and idempotent processing; do not claim end-to-end exactly-once processing.
- No secrets, real customer logs, or real production credentials in sample data or Git.
- Do not claim performance, scale, compliance, or security properties without reproducible evidence.
- Use synthetic security events and isolated simulations for demos and tests.
