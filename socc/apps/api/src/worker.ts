import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { WorkerModule } from "./worker.module.js";
import { JsonLoggerService } from "./logger/json-logger.service.js";
import { EventConsumerService } from "./pipeline/event-consumer.service.js";
import { OutboxPublisherService } from "./pipeline/outbox-publisher.service.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  const logger = app.get(JsonLoggerService);
  app.useLogger(logger);

  const publisher = app.get(OutboxPublisherService);
  const consumer = app.get(EventConsumerService);
  const abort = new AbortController();
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log(`${signal} received; draining SOCC worker`, "Worker");
    abort.abort();
    void app
      .close()
      .catch((error: unknown) => {
        logger.error(
          `Worker shutdown error: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
          undefined,
          "Worker",
        );
      })
      .finally(() => process.exit(0));
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  logger.log("SOCC worker started", "Worker");
  await Promise.all([publisher.run(abort.signal), consumer.run(abort.signal)]);
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown error";
  process.stderr.write(`SOCC worker failed to start: ${message}\n`);
  process.exit(1);
});
