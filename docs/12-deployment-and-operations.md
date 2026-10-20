# Deployment and Operations

## 1. Local development

Use Docker Compose for the initial local environment. Services may include:
- Next.js frontend.
- NestJS API.
- Event processor.
- Background job worker.
- PostgreSQL.
- Redis.
- S3-compatible object-storage emulator.
- Optional Prometheus/Grafana/trace collector.

Document prerequisites, environment setup, migrations, seed data, start/stop commands, tests, and troubleshooting. Use development-only credentials and synthetic data.

## 2. Environment separation

Maintain separate configuration and credentials for development, test, staging, and production. Validate required environment variables at startup. Do not expose server-only secrets to client bundles. Never commit real `.env` files.

## 3. Production topology

Start with a managed PostgreSQL service, managed or appropriately configured Redis, object storage, a load balancer/WAF, horizontally scalable API instances, and separate worker deployments where practical. Add Kubernetes only if its operational benefits justify its complexity.

## 4. CI/CD

Pipeline should include:
1. Formatting and lint.
2. Type checking.
3. Unit tests.
4. Integration tests.
5. Migration validation.
6. Dependency and secret scans.
7. Container build and scan.
8. Critical end-to-end tests.
9. Deployment to staging.
10. Health checks and controlled production rollout.

Use backward-compatible schema changes and a rollback/recovery plan. Do not run destructive migrations automatically without explicit review.

## 5. Observability

Use structured logs with request ID, trace ID, service name, and safe organization context where appropriate. Avoid logging raw secrets or unnecessary sensitive event content.

Metrics should include:
- API request rate, errors, p50/p95/p99 latency.
- Database pool saturation and query latency.
- Event accepted/processed/rejected rate.
- Outbox age and pending count.
- Queue lag and oldest pending message.
- Worker retries and failures.
- Detection latency and alert creation rate.
- Notification failures.
- LLM latency, failures, usage, and cost.
- CPU, memory, disk, Redis memory, and storage growth.

Propagate trace context across queue messages where possible. Monitor queue age in addition to worker execution time.

## 6. Operational alerts

Create actionable alerts for:
- Sustained API error-rate increase.
- High latency.
- Database connection saturation.
- Outbox backlog.
- Queue lag or oldest event age.
- Repeated worker failures.
- Storage capacity risk.
- Redis memory pressure.
- Backup failure.
- Notification delivery failure.
- LLM provider degradation (without making it a core-service outage).

Avoid alert rules that create noisy alerts without a clear owner or response action.

## 7. Reliability and failure handling

- PostgreSQL unavailable: do not falsely acknowledge new events as durable.
- Redis unavailable: retain outbox and retry.
- Worker crash: reclaim/retry pending messages and process idempotently.
- LLM unavailable: keep core detection and incident workflows operational.
- Email/webhook failure: retry asynchronously and expose delivery status.
- Malformed event: reject or quarantine with a safe reason.
- Queue overload: apply backpressure and honest acceptance behavior.
- Storage pressure: alert operators and follow explicit retention/admission policy.

## 8. Backup and recovery

Define RPO and RTO as targets, not claims. Example proposed targets for planning are RPO five minutes and RTO one hour; validate against the chosen hosting setup.

Document and test:
- PostgreSQL backup and restoration.
- Object-storage recovery.
- Redis recovery expectations.
- Re-publication of outbox messages.
- Event replay and deduplication.
- Restore of configuration and tenant settings.
- Recovery from partial processing.
- Credential rotation after suspected compromise.

A backup is not validated until restoration has been tested.

## 9. Retention and deletion

Define separate retention rules for raw events, normalized events, alerts, incidents, audit logs, evidence, AI summaries, exports, and failed jobs. Deletion workflows must account for PostgreSQL, object storage, search indexes if present, and backups. Support legal hold only if it is intentionally designed and documented.

## 10. Runbooks

Create runbooks for:
- Queue backlog.
- Redis outage.
- Database saturation.
- Event ingestion spike.
- Failed migration.
- Suspected credential compromise.
- Tenant-isolation incident.
- Evidence access issue.
- Backup restore.
- LLM provider outage.
