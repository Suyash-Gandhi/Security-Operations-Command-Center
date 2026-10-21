import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import type { Server } from "node:http";
import type { PrismaClient } from "@prisma/client";
import {
  ApiClient,
  cleanupSynthetic,
  createTestApp,
  ownerPrisma,
  registerUser,
} from "./helpers.js";

interface CreatedSource {
  source: { id: string; name: string; status: string };
  credential: string;
}

async function createSource(
  client: ApiClient,
  orgId: string,
  name: string,
): Promise<CreatedSource> {
  const res = await client.post(
    "/v1/event-sources",
    { name, sourceType: "synthetic" },
    orgId,
  );
  expect(res.status).toBe(201);
  return res.body as CreatedSource;
}

async function ingest(
  client: ApiClient,
  credential: string,
  body: unknown,
  idempotencyKey?: string,
) {
  let request = client
    .post("/v1/events/ingest", body, undefined)
    .set("Authorization", `Bearer ${credential}`);
  if (idempotencyKey) request = request.set("Idempotency-Key", idempotencyKey);
  return request;
}

function eventBody(sourceEventId: string, extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    events: [
      {
        sourceEventId,
        eventType: "auth.login",
        eventTime: new Date().toISOString(),
        severity: "LOW",
        actor: "synthetic-user",
        sourceIp: "192.0.2.10",
        attributes: { result: "success" },
        ...extra,
      },
    ],
  };
}

describe("Phase 2 assets, event sources, and ingestion", () => {
  let app: INestApplication;
  let server: Server;
  let owner: PrismaClient;

  const userIds: string[] = [];
  const orgIds: string[] = [];

  let clientA: ApiClient;
  let clientB: ApiClient;
  let orgA: string;
  let orgB: string;
  let source: CreatedSource;
  let assetId: string;

  beforeAll(async () => {
    ({ app, server } = await createTestApp());
    owner = ownerPrisma();

    clientA = new ApiClient(server);
    const a = await registerUser(clientA, "phase2A");
    userIds.push(a.userId);
    orgIds.push(a.organizationId);
    orgA = a.organizationId;

    clientB = new ApiClient(server);
    const b = await registerUser(clientB, "phase2B");
    userIds.push(b.userId);
    orgIds.push(b.organizationId);
    orgB = b.organizationId;

    const asset = await clientA.post(
      "/v1/assets",
      {
        name: "Synthetic workstation",
        assetType: "workstation",
        hostname: "synthetic-ws-01.socc.test",
        environment: "test",
        criticality: "medium",
      },
      orgA,
    );
    expect(asset.status).toBe(201);
    assetId = asset.body.id as string;

    source = await createSource(clientA, orgA, "Synthetic IdP");
  });

  afterAll(async () => {
    await app.close();
    await cleanupSynthetic(owner, userIds, orgIds);
    await owner.$disconnect();
  });

  it("creates and lists assets within the organization", async () => {
    const list = await clientA.get("/v1/assets?limit=10", orgA);
    expect(list.status).toBe(200);
    const ids = (list.body.assets as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toContain(assetId);

    const fetched = await clientA.get(`/v1/assets/${assetId}`, orgA);
    expect(fetched.status).toBe(200);
    expect(fetched.body.hostname).toBe("synthetic-ws-01.socc.test");
  });

  it("updates and deactivates an asset", async () => {
    const updated = await clientA.patch(
      `/v1/assets/${assetId}`,
      { criticality: "high" },
      orgA,
    );
    expect(updated.status).toBe(200);
    expect(updated.body.criticality).toBe("high");

    const deactivated = await clientA.patch(
      `/v1/assets/${assetId}`,
      { status: "INACTIVE" },
      orgA,
    );
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.status).toBe("INACTIVE");
  });

  it("never exposes source credentials after creation", async () => {
    const list = await clientA.get("/v1/event-sources", orgA);
    expect(list.status).toBe(200);
    const raw = JSON.stringify(list.body);
    expect(raw).not.toContain(source.credential);
    expect(raw).not.toContain("credentialHash");
  });

  it("accepts a valid batch and records durable acceptance", async () => {
    const res = await ingest(
      clientA,
      source.credential,
      eventBody("evt-accepted-1"),
      "idem-accepted-1",
    );
    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(true);
    expect(res.body.acceptedCount).toBe(1);
    expect(res.body.rejectedCount).toBe(0);
    expect(res.body.status).toBe("ACCEPTED");

    const batch = await clientA.get(
      `/v1/event-batches/${res.body.batchId as string}`,
      orgA,
    );
    expect(batch.status).toBe(200);
    expect(batch.body.acceptedCount).toBe(1);
    expect(batch.body.processedCount).toBe(0);

    const outbox = await owner.outboxMessage.count({
      where: { organizationId: orgA, messageType: "security.event.accepted" },
    });
    expect(outbox).toBeGreaterThanOrEqual(1);
  });

  it("replays the same idempotent request without creating duplicates", async () => {
    const body = eventBody("evt-idempotent-2");
    const first = await ingest(clientA, source.credential, body, "idem-replay-1");
    expect(first.status).toBe(202);
    expect(first.body.idempotentReplay).toBe(false);

    const second = await ingest(clientA, source.credential, body, "idem-replay-1");
    expect(second.status).toBe(202);
    expect(second.body.idempotentReplay).toBe(true);
    expect(second.body.batchId).toBe(first.body.batchId);

    const count = await owner.securityEvent.count({
      where: { organizationId: orgA, sourceEventId: "evt-idempotent-2" },
    });
    expect(count).toBe(1);
  });

  it("rejects reuse of an idempotency key with a different body", async () => {
    const first = await ingest(
      clientA,
      source.credential,
      eventBody("evt-conflict-1"),
      "idem-conflict-1",
    );
    expect(first.status).toBe(202);

    const conflict = await ingest(
      clientA,
      source.credential,
      eventBody("evt-conflict-2"),
      "idem-conflict-1",
    );
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("deduplicates repeated source event ids across batches", async () => {
    const first = await ingest(clientA, source.credential, eventBody("evt-duplicate-1"));
    expect(first.status).toBe(202);
    expect(first.body.accepted).toBe(true);

    const duplicate = await ingest(
      clientA,
      source.credential,
      eventBody("evt-duplicate-1"),
    );
    expect(duplicate.status).toBe(202);
    expect(duplicate.body.accepted).toBe(false);
    expect(duplicate.body.rejectedCount).toBe(1);
    expect(duplicate.body.status).toBe("REJECTED");

    const count = await owner.securityEvent.count({
      where: { organizationId: orgA, sourceEventId: "evt-duplicate-1" },
    });
    expect(count).toBe(1);
  });

  it("rejects a batch where every event is invalid", async () => {
    const res = await ingest(clientA, source.credential, {
      schemaVersion: 1,
      events: [{ eventType: "auth.login", eventTime: "not-a-timestamp" }],
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(res.body)).not.toContain("not-a-timestamp");
  });

  it("rejects cross-organization asset references per event", async () => {
    const res = await ingest(
      clientA,
      source.credential,
      eventBody("evt-cross-tenant-asset", { assetId }),
    );
    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(true);

    const otherSource = await createSource(clientB, orgB, "Other tenant source");
    const crossTenant = await ingest(
      clientB,
      otherSource.credential,
      eventBody("evt-cross-tenant-asset-b", { assetId }),
    );
    expect(crossTenant.status).toBe(202);
    expect(crossTenant.body.accepted).toBe(false);
    expect(
      (crossTenant.body.errors as Array<{ code: string }>).some(
        (e) => e.code === "ASSET_NOT_FOUND",
      ),
    ).toBe(true);
  });

  it("rejects unauthenticated and disabled sources", async () => {
    const unauthorized = await clientA
      .post("/v1/events/ingest", eventBody("evt-noauth"))
      .set("Authorization", "Bearer socc_src_not-a-real-credential");
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.body.code).toBe("SOURCE_AUTH_FAILED");

    const disabledSource = await createSource(clientA, orgA, "Disabled source");
    const disabled = await clientA.patch(
      `/v1/event-sources/${disabledSource.source.id}/status`,
      { status: "DISABLED" },
      orgA,
    );
    expect(disabled.status).toBe(200);

    const rejected = await ingest(
      clientA,
      disabledSource.credential,
      eventBody("evt-disabled-source"),
    );
    expect(rejected.status).toBe(403);
    expect(rejected.body.code).toBe("SOURCE_DISABLED");
  });

  it("rotating a source credential invalidates the old one", async () => {
    const rotating = await createSource(clientA, orgA, "Rotating source");
    const rotated = await clientA.post(
      `/v1/event-sources/${rotating.source.id}/rotate-credential`,
      {},
      orgA,
    );
    expect(rotated.status).toBe(200);
    expect(rotated.body.credential).not.toBe(rotating.credential);

    const old = await ingest(clientA, rotating.credential, eventBody("evt-rotated-old"));
    expect(old.status).toBe(401);

    const fresh = await ingest(
      clientA,
      rotated.body.credential as string,
      eventBody("evt-rotated-new"),
    );
    expect(fresh.status).toBe(202);
    expect(fresh.body.accepted).toBe(true);
  });

  it("conceals other organizations' assets, batches, events, and sources", async () => {
    const events = await clientA.get("/v1/events?limit=10", orgA);
    expect(events.status).toBe(200);
    const eventId = (events.body.events as Array<{ id: string }>)[0]?.id;
    expect(eventId).toBeTruthy();

    const assetB = await clientB.get(`/v1/assets/${assetId}`, orgB);
    expect(assetB.status).toBe(404);
    expect(assetB.body.code).toBe("ASSET_NOT_FOUND");

    const eventB = await clientB.get(`/v1/events/${eventId}`, orgB);
    expect(eventB.status).toBe(404);
    expect(eventB.body.code).toBe("EVENT_NOT_FOUND");

    const sourcesB = await clientB.get("/v1/event-sources", orgB);
    const sourceIds = (sourcesB.body.sources as Array<{ id: string }>).map((s) => s.id);
    expect(sourceIds).not.toContain(source.source.id);

    const rotateB = await clientB.post(
      `/v1/event-sources/${source.source.id}/rotate-credential`,
      {},
      orgB,
    );
    expect(rotateB.status).toBe(404);
    expect(rotateB.body.code).toBe("EVENT_SOURCE_NOT_FOUND");
  });
});
