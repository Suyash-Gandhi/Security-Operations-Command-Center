import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  DetectionRuleConfig,
  RuleDefinition,
  ThresholdConfig,
} from "./detection.types.js";

function getFieldValue(
  event: Record<string, unknown>,
  field: string | undefined,
): string | undefined {
  if (!field) return undefined;
  if (field in event) {
    const v = event[field];
    return v == null ? undefined : String(v);
  }
  if (event.normalizedPayload && typeof event.normalizedPayload === "object") {
    const p = event.normalizedPayload as Record<string, unknown>;
    if (field in p) return p[field] == null ? undefined : String(p[field]);
  }
  return undefined;
}

function getGroupKey(event: Record<string, unknown>, groupBy?: string[]): string {
  if (!groupBy || groupBy.length === 0) return "global";
  const parts = groupBy.map((g) => {
    if (g === "organizationId") return String(event.organizationId ?? "unknown");
    if (g === "sourceId") return String(event.sourceId ?? "unknown");
    if (g === "assetId") return event.assetId == null ? "none" : String(event.assetId);
    if (g === "actor") {
      const a =
        event.actor ??
        (event.normalizedPayload as Record<string, unknown> | undefined)?.actor;
      return a == null ? "unknown" : String(a);
    }
    if (g === "sourceIp") {
      const s =
        event.sourceIp ??
        (event.normalizedPayload as Record<string, unknown> | undefined)?.sourceIp;
      return s == null ? "unknown" : String(s);
    }
    const v = getFieldValue(event, g);
    return v ?? "unknown";
  });
  return parts.join("|");
}

@Injectable()
export class DetectionEngineService {
  private readonly logger = new Logger(DetectionEngineService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async loadRules(organizationId: string): Promise<RuleDefinition[]> {
    const rules = await (this.prisma as unknown as {
      detectionRule: { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> };
    }).detectionRule.findMany({
      where: {
        enabled: true,
        OR: [{ organizationId }, { organizationId: null }],
      },
    });
    return (rules as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      organizationId: (r.organizationId as string) ?? null,
      name: r.name as string,
      description: r.description as string,
      ruleType: r.ruleType as RuleDefinition["ruleType"],
      configuration: r.configuration as unknown as DetectionRuleConfig,
      severity: r.severity as RuleDefinition["severity"],
      enabled: Boolean(r.enabled),
      version: Number(r.version),
    }));
  }

  async evaluateEvent(eventId: string, organizationId: string): Promise<void> {
    await this.prisma.runWithOrg(organizationId, async (tx) => {
      const event = await tx.securityEvent.findFirst({
        where: { id: eventId, organizationId },
      });
      if (!event) return;

      const rules = await this.loadRules(organizationId);
      for (const rule of rules) {
        try {
          if (rule.ruleType === "THRESHOLD") {
            await this.evaluateThreshold(
              tx,
              event as unknown as Record<string, unknown>,
              rule,
            );
          } else if (rule.ruleType === "SEQUENCE") {
            continue;
          }
        } catch (error) {
          this.logger.warn(
            `Rule evaluation failed for rule ${rule.id}: ${error instanceof Error ? error.message : "unknown"}`,
          );
        }
      }
    });
  }

  private async evaluateThreshold(
    tx: Prisma.TransactionClient,
    event: Record<string, unknown>,
    rule: RuleDefinition,
  ): Promise<void> {
    const config = rule.configuration as ThresholdConfig;
    if (config.ruleType !== "THRESHOLD") return;
    if (config.eventType && config.eventType !== event.eventType) return;

    if (config.field && config.value && config.operator) {
      const v = getFieldValue(event, config.field);
      if (config.operator === "EQ" && v !== config.value) return;
      if (config.operator === "NEQ" && v === config.value) return;
    }

    const windowMinutes = config.windowMinutes ?? 5;
    const threshold = config.threshold ?? 10;
    const groupKey = getGroupKey(event, config.groupBy);

    const eventTime = event.eventTime as Date;
    const windowStart = new Date(eventTime.getTime() - windowMinutes * 60 * 1000);

    const where: Prisma.SecurityEventWhereInput = {
      organizationId: event.organizationId as string,
      eventType: config.eventType,
      eventTime: {
        gte: windowStart,
        lte: eventTime,
      },
    };
    if (config.groupBy?.includes("actor"))
      where.actor = event.actor as string | null | undefined;
    if (config.groupBy?.includes("sourceIp"))
      where.sourceIp = event.sourceIp as string | null | undefined;
    if (config.groupBy?.includes("sourceId")) where.sourceId = event.sourceId as string;
    if (config.groupBy?.includes("assetId") && event.assetId)
      where.assetId = event.assetId as string;

    const count = await tx.securityEvent.count({ where });

    if (count < threshold) return;

    const matchKey = `${rule.id}:${groupKey}:${Math.floor(eventTime.getTime() / (windowMinutes * 60 * 1000))}`;
    const evidence = {
      ruleId: rule.id,
      ruleName: rule.name,
      ruleVersion: rule.version,
      groupKey,
      count,
      threshold,
      windowMinutes,
      windowStart: windowStart.toISOString(),
      windowEnd: eventTime.toISOString(),
      matchedEventId: event.id,
    };

    await (tx as unknown as {
      detectionMatch: { create: (args: unknown) => Promise<unknown> };
    }).detectionMatch
      .create({
        data: {
          organizationId: event.organizationId as string,
          ruleId: rule.id,
          ruleVersion: rule.version,
          matchKey,
          eventId: event.id as string,
          evidence: evidence as unknown as Prisma.InputJsonValue,
        },
      })
      .catch((err: unknown) => {
        const e = err as { code?: string };
        if (e.code === "P2002") return;
        throw err;
      });

    await this.upsertAlert(tx, event, rule, matchKey, evidence);
  }

  private async upsertAlert(
    tx: Prisma.TransactionClient,
    event: Record<string, unknown>,
    rule: RuleDefinition,
    matchKey: string,
    _evidence: unknown,
  ): Promise<void> {
    const alert = await (tx as unknown as {
    alert: { findUnique: (args: unknown) => Promise<Record<string, unknown> | null>; update: (args: unknown) => Promise<unknown>; create: (args: unknown) => Promise<Record<string, unknown>> };
    alertEvent: { create: (args: unknown) => Promise<unknown> };
  }).alert.findUnique({
      where: {
        organizationId_ruleId_matchKey: {
          organizationId: event.organizationId as string,
          ruleId: rule.id,
          matchKey,
        },
      },
    });

    if (alert) {
      await (tx as unknown as {
        alert: { update: (args: unknown) => Promise<unknown> };
        alertEvent: { create: (args: unknown) => Promise<unknown> };
      }).alert.update({
        where: { id: alert.id as string },
        data: {
          lastSeenAt: new Date(),
          count: { increment: 1 },
        },
      });
      await (tx as unknown as {
        alertEvent: { create: (args: unknown) => Promise<unknown> };
      }).alertEvent
        .create({
          data: {
            alertId: alert.id as string,
            eventId: event.id as string,
          },
        })
        .catch(() => {
          // ignore duplicate alert event
        });
      return;
    }

    const newAlert = await (tx as unknown as {
      alert: { create: (args: unknown) => Promise<Record<string, unknown>> };
      alertEvent: { create: (args: unknown) => Promise<unknown> };
    }).alert.create({
      data: {
        organizationId: event.organizationId as string,
        ruleId: rule.id,
        ruleVersion: rule.version,
        severity: rule.severity,
        status: "OPEN",
        title: rule.name,
        description: rule.description,
        matchKey,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        count: 1,
        assetId: (event.assetId as string) ?? null,
        primaryEventId: (event.id as string) ?? null,
      },
    });
    await (tx as unknown as {
      alertEvent: { create: (args: unknown) => Promise<unknown> };
    }).alertEvent
      .create({
        data: {
          alertId: newAlert.id as string,
          eventId: event.id as string,
        },
      })
      .catch(() => {
        // ignore duplicate alert event
      });
  }
}
