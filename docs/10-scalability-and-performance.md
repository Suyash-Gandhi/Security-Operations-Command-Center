# Scalability and Performance Plan

## 1. Workload dimensions

Track these separately:
- Registered users.
- Concurrent authenticated users.
- Active SSE connections.
- API requests per second.
- Event ingestion events per second.
- Average and percentile event size.
- Detection processing rate.
- Search query rate and query mix.
- Queue lag and oldest event age.
- Tenant traffic distribution.
- Data retention period and storage growth.

Registered-user count alone is not a capacity estimate.

## 2. Proposed targets

Targets to benchmark, not current guarantees:
- 1,000 events/second sustained.
- 5,000 events/second for a defined burst.
- 1,000 concurrent users initially.
- 10,000 concurrent users as a later target.
- p95 below 200 ms for selected ordinary API routes.
- p95 below 250 ms for durable event acceptance in the defined load test.
- p95 below 500 ms for selected event searches on a documented dataset.

For each benchmark document CPU, memory, instance sizes, replicas, database configuration, event size, data volume, tenant count, duration, error rate, p50/p95/p99, queue lag, and resource utilization.

## 3. Event volume estimation

At 1,000 events/second and 2 KB average payload size:

`1,000 × 2 KB = approximately 2 MB/second`

`2 MB/second × 86,400 seconds = approximately 172.8 GB/day`

This is raw payload volume before database row overhead, indexes, replication, backups, raw payload retention, and other storage costs. Actual disk usage must be measured.

## 4. Horizontal scaling

- Keep API instances stateless where practical.
- Store session state in a shared or identity-provider-backed system.
- Scale API replicas based on request latency, CPU, memory, and saturation.
- Scale event workers based on queue lag and measured processing rate.
- Scale notification/import workers independently.
- Bound concurrency so additional workers do not overwhelm PostgreSQL.
- Configure graceful shutdown so in-flight jobs can be completed or safely retried.

## 5. Database and connection management

- Use connection pools and monitor pool wait time.
- Consider PgBouncer where appropriate.
- Avoid a pool size per replica that multiplies into excessive database connections.
- Inspect slow queries and query plans.
- Use composite indexes based on observed filter patterns.
- Batch inserts and reads where appropriate.
- Avoid N+1 queries.
- Use precomputed aggregates for dashboard metrics.
- Consider partitioning high-volume event data when volume and retention justify it.
- Consider read replicas only after measuring read pressure and verifying replica lag is acceptable.

## 6. Caching

Cache stable or expensive data selectively: organization configuration, rule configuration, asset metadata, and dashboard aggregates. Define TTL and invalidation behavior.

Do not allow stale permissions, disabled users, or revoked credentials to remain effective due to cache behavior. Do not treat Redis cache as authoritative incident state.

## 7. Search evolution

Start with PostgreSQL indexes and time-bounded queries. Evaluate OpenSearch only when measured search requirements justify its indexing, operations, and consistency costs. If added, PostgreSQL remains the source of truth; define index refresh, reconciliation, deletion, and rebuild procedures.

## 8. Queue and backpressure

Monitor queue length, consumer lag, oldest pending age, retry counts, and processing rate. Apply quotas and bounded queue/worker behavior. Do not silently discard accepted security events. If capacity is exhausted, fail or defer acceptance honestly and document client retry behavior.

## 9. Load-test scenarios

- Ramp from low load to target concurrency.
- Sustain the target for a defined interval.
- Burst ingestion above the sustained rate.
- Mixed dashboard/search/incident update traffic.
- 10,000 mostly idle SSE connections if that target is pursued.
- Active users with realistic think time and varied requests.
- One hot tenant producing a large share of events.
- Slow database or Redis dependency.
- Worker restart during processing.
- LLM provider latency and failure, separately from core API benchmarks.

## 10. Benchmark reporting

Publish a report with:
- Commit hash and configuration.
- Test hardware/topology.
- Dataset and event size distribution.
- User scenario and request mix.
- Throughput and error rate.
- p50/p95/p99 latency.
- Queue lag and event processing delay.
- CPU, memory, database, and Redis metrics.
- Bottleneck found.
- Optimization performed.
- Before/after results.
- Known limitations.

Never state “supports 10,000 concurrent users” without a reproducible test that defines what those users are doing.
