import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import type { Server } from "node:http";
import type { PrismaClient } from "@prisma/client";
import { AppModule } from "../../src/app.module.js";
import { PipelineModule } from "../../src/pipeline/pipeline.module.js";
import { JsonLoggerService } from "../../src/logger/json-logger.service.js";
import { AllExceptionsFilter } from "../../src/common/all-exceptions.filter.js";
import { AppConfigService } from "../../src/config/app-config.service.js";
import { RedisService } from "../../src/pipeline/redis.service.js";
import { OutboxPublisherService } from "../../src/pipeline/outbox-publisher.service.js";
import { EventConsumerService } from "../../src/pipeline/event-consumer.service.js";
import { ApiClient, cleanupSynthetic, ownerPrisma, registerUser } from "./helpers.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Phase 2 transactional outbox and Redis Stream consumer", () => {
  let app: INestApplication;
  let server: Server;
  let owner: PrismaClient;
  let redis: RedisService;
  let publisher: OutboxPublisherService;
  let consumer: EventConsumerService;
  let stream: string;
  let group: string;

  const userIds: string[] = [];
  const orgIds: string[] = [];
  let client: ApiClient;
  let orgId: string;
  let credential: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, PipelineModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["health", "health/ready"] });
    app.useGlobalFilters(new AllExceptionsFilter(moduleRef.get(JsonLoggerService)));
    await app.init();
    server = app.getHttpServer();

    const config = app.get(AppConfigService);
    stream = config.redisStream;
    group = config.redisConsumerGroup;
    redis = app.get(RedisService);
    publisher = app.get(OutboxPublisherService);
    consumer = app.get(EventConsumerService);

    await redis.connection.del(stream, `${stream}.dead-letter`);
    await redis.connection.del(`socc:delivery:${stream}:${group}`);

    owner = ownerPrisma();
    client = new ApiClient(server);
    const registered = await registerUser(client, "pipeline");
    userIds.push(registered.userId);
    orgIds.push(registered.organizationId);
    orgId = registered.organizationId;

    const source = await client.post(
      "/v1/event-sources",
      { name: "Pipeline source", sourceType: "synthetic" },
      orgId,
    );
    expect(source.status).toBe(201);
    credential = source.body.credential as string;
  }, 60_000);

  afterAll(async () => {
    if (redis) {
      await redis.connection.del(stream, `${stream}.dead-letter`);
      await redis.connection.del(`socc:delivery:${stream}:${group}`);
    }
    await app.close();
    await cleanupSynthetic(owner, userIds, orgIds);
    await owner.$disconnect();
  });

  it("publishes accepted events and processes them idempotently to completion", async () => {
    const ingested = await client
      .post("/v1/events/ingest", {
        schemaVersion: 1,
        events: [
          {
            sourceEventId: "pipeline-evt-1",
            eventType: "auth.login",
            eventTime: new Date().toISOString(),
            attributes: { result: "success" },
          },
        ],
      })
      .set("Authorization", `Bearer ${credential}`)
      .set("Idempotency-Key", "pipeline-idem-1");
    expect(ingested.status).toBe(202);
    expect(ingested.body.accepted).toBe(true);
    const batchId = ingested.body.batchId as string;

    const claimed = await publisher.publishPending();
    expect(claimed).toBeGreaterThanOrEqual(1);
    expect(await redis.connection.xlen(stream)).toBeGreaterThanOrEqual(1);

    const abort = new AbortController();
    const runPromise = consumer.run(abort.signal);

    let status = "";
    let eventId: string | undefined;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const batch = await client.get(`/v1/event-batches/${batchId}`, orgId);
      if (batch.status === 200) {
        status = batch.body.status as string;
        if (status === "COMPLETED") {
          const events = await client.get("/v1/events?limit=10", orgId);
          const match = (
            events.body.events as Array<{
              id: string;
              sourceEventId: string | null;
              processedAt: string | null;
            }>
          ).find((event) => event.sourceEventId === "pipeline-evt-1");
          eventId = match?.id;
          expect(match?.processedAt).toBeTruthy();
          break;
        }
      }
      await sleep(200);
    }

    expect(status).toBe("COMPLETED");
    expect(eventId).toBeTruthy();

    const batch = await client.get(`/v1/event-batches/${batchId}`, orgId);
    expect(batch.body.processedCount).toBe(1);
    expect(batch.body.completedAt).toBeTruthy();

    abort.abort();
    await runPromise;
  }, 40_000);
});
