# Security Architecture and Threat Model

## 1. Security objective

Protect organization data, identity, event integrity, detection configuration, evidence, and service availability. Treat the platform itself as a security-sensitive application.

## 2. Assets to protect

- User accounts and sessions.
- Organization memberships and permissions.
- Raw and normalized security events.
- Detection rules and alert state.
- Incidents and evidence.
- Source credentials and API secrets.
- Audit records.
- AI prompts, context, and outputs.
- Backups, exports, and object storage.
- Service availability and event-processing integrity.

## 3. Threats and controls

| Threat | Controls |
|---|---|
| Cross-tenant access | Trusted tenant context, application authorization, PostgreSQL RLS, isolation tests |
| Stolen credentials | MFA, secure sessions, login throttling, revocation |
| Forged events | Source authentication, signatures where supported, schema validation |
| Event flooding | Per-source/tenant quotas, payload limits, bounded queues, backpressure |
| Unauthorized rule changes | RBAC, versioning, audit logging |
| Evidence disclosure | Object-level authorization, short-lived access where appropriate, checksums |
| Secret leakage | Secret manager, redaction, rotation, secret scanning |
| SSRF via webhooks | Destination allowlists/policies, DNS/IP validation, redirect controls, egress restrictions |
| Prompt injection in logs | Treat event data as untrusted, minimize context, no unrestricted tools |
| Audit tampering | Restricted write paths, retention controls, optional tamper-evident checkpoints |
| Resource exhaustion | Timeouts, limits, query caps, worker concurrency limits |
| Dependency compromise | Lockfiles, dependency scanning, updates, container scanning |
| Data loss | Durable acceptance, outbox, idempotent retries, tested backups |

## 4. Authentication and sessions

Prefer a mature OIDC-compatible identity provider or established authentication framework. Do not invent cryptographic protocols.

If passwords are managed by the app, use a modern password hashing scheme supported by a maintained library. Support MFA, session expiration, revocation, recovery, and login throttling.

For browser sessions, use secure server-managed cookies with suitable `HttpOnly`, `Secure`, and `SameSite` settings. Apply CSRF defenses where applicable. Do not put long-lived privileged credentials in browser storage.

For external tokens, validate signature, issuer, audience, expiry, and relevant claims according to the provider protocol.

## 5. Authorization

Check all of the following on protected operations:
1. Authenticated principal.
2. Trusted active organization membership.
3. Required permission.
4. Resource organization ownership.
5. Permitted state transition.
6. Required audit event.

Hiding a button in the frontend is not authorization. Every API, export, search, SSE subscription, background job, and AI endpoint must enforce scope.

## 6. PostgreSQL RLS

Use RLS as defense in depth for tenant-owned tables.

- Set tenant context transaction-locally.
- Use application DB roles that do not bypass RLS.
- Understand table-owner and `BYPASSRLS` behavior.
- Avoid leaking tenant context across pooled connections.
- Apply policies consistently.
- Test direct SQL access through the application role.
- Scope background jobs and scheduled tasks explicitly.
- Treat privileged administrative bypass as a separate, audited capability.

RLS does not replace application-level permission checks.

## 7. API and browser security

- Validate every request body and query.
- Enforce request size and timeout limits.
- Use parameterized SQL or safe ORM APIs.
- Configure CORS narrowly.
- Apply CSRF protection where relevant.
- Prevent XSS through safe rendering and output handling.
- Use secure headers.
- Avoid detailed internal errors in production.
- Rate-limit sensitive operations.
- Prevent account enumeration where appropriate.
- Use a safe content security policy when compatible with the app.

## 8. Inbound and outbound webhooks

Inbound:
- Authenticate source.
- Verify signatures when available.
- Validate timestamps and replay windows where applicable.
- Limit body size and rate.
- Record source identity.
- Rotate secrets.

Outbound:
- Validate allowed schemes and destinations.
- Block loopback, private, link-local, and other prohibited destinations as appropriate.
- Resolve and validate destination IPs and revalidate redirects.
- Defend against DNS rebinding.
- Apply network egress controls.
- Set connection/read timeouts and response limits.
- Never forward internal credentials to webhook destinations.

## 9. Secrets and logging

- Do not commit `.env` files or real secrets.
- Use local environment variables for development and managed secrets for deployment.
- Use separate credentials per environment and service.
- Rotate credentials and minimize privileges.
- Redact tokens, cookies, passwords, and sensitive payload fields.
- Avoid logging full raw events unless explicitly required and protected.
- Do not expose secrets in exception messages, traces, or AI prompts.

## 10. Audit and evidence integrity

Audit sensitive actions including login/security changes, membership and role changes, rule edits, incident transitions, evidence access/deletion, exports, credential rotation, and retention changes.

Audit records should include actor, organization, action, target, time, request ID, and relevant metadata. Ordinary users must not edit or delete audit records.

Optional tamper-evident hashing can make modification detectable but is not absolute immutability if an attacker controls the storage and signing keys.

## 11. AI security boundary

- Event content and evidence are untrusted.
- The LLM has no unrestricted database, shell, or network access.
- Authorization and tool permission checks happen outside the model.
- Model outputs are untrusted and must be validated.
- The model cannot independently execute containment or remediation.
- Minimize and redact context.
- Keep provider keys server-side.
- Apply per-tenant quotas and timeouts.

## 12. Security verification

Required tests include cross-tenant access attempts, broken object-level authorization, privilege escalation, session revocation, malformed payloads, rate limits, SSRF protections, evidence access, export scope, prompt injection fixtures, and dependency/secret scans.

Use synthetic data and isolated environments. Do not test against infrastructure without explicit authorization.
