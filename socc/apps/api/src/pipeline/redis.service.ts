import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Injectable, Logger } from "@nestjs/common";
import { Redis } from "ioredis";
import { AppConfigService } from "../config/app-config.service.js";

/**
 * Owns the worker's Redis connection. The API process never publishes directly
 * to Redis: ingestion commits to PostgreSQL and the outbox publisher drains it.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(config: AppConfigService) {
    this.client = new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy: (times) => Math.min(times * 200, 2000),
    });
    this.client.on("error", (error: Error) => {
      this.logger.error(`Redis connection error: ${error.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    await this.client.ping();
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }

  get connection(): Redis {
    return this.client;
  }

  async ensureConsumerGroup(stream: string, group: string): Promise<void> {
    try {
      await this.client.xgroup("CREATE", stream, group, "0", "MKSTREAM");
      this.logger.log(`Created consumer group ${group} on ${stream}`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("BUSYGROUP")) {
        return;
      }
      throw error;
    }
  }
}
