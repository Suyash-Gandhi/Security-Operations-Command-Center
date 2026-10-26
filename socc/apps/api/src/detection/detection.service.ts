import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { AuditService } from "../audit/audit.service.js";

@Injectable()
export class DetectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listRules(organizationId: string) {
    return (this.prisma as unknown as { detectionRule: { findMany: (args: unknown) => Promise<unknown[]> } }).detectionRule.findMany({
      where: {
        OR: [{ organizationId }, { organizationId: null }],
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async createRule(
    organizationId: string,
    actorId: string | undefined,
    body: Record<string, unknown>,
  ) {
    const rule = await (this.prisma as unknown as { detectionRule: { create: (args: unknown) => Promise<Record<string, unknown>> } }).detectionRule.create({
      data: {
        organizationId: body.scope === "platform" ? null : organizationId,
        name: body.name as string,
        description: (body.description as string) ?? "",
        ruleType: body.ruleType,
        configuration: (body.configuration ?? {}) as unknown,
        severity: body.severity,
        enabled: body.enabled ?? true,
        version: 1,
        createdBy: actorId ?? null,
      },
    });
    await (this.audit as unknown as { record: (args: unknown) => Promise<unknown> }).record({
      organizationId,
      actorId: actorId ?? null,
      action: "detection.rule_created",
      resourceType: "detection_rule",
      resourceId: rule.id,
      metadata: { name: rule.name },
    });
    return rule;
  }

  async getRule(organizationId: string, ruleId: string) {
    const rule = await (this.prisma as unknown as { detectionRule: { findFirst: (args: unknown) => Promise<Record<string, unknown> | null> } }).detectionRule.findFirst({
      where: {
        id: ruleId,
        OR: [{ organizationId }, { organizationId: null }],
      },
    });
    if (!rule)
      throw new NotFoundException({
        code: "DETECTION_RULE_NOT_FOUND",
        message: "Detection rule not found",
      });
    return rule;
  }

  async updateRule(
    organizationId: string,
    actorId: string | undefined,
    ruleId: string,
    body: Record<string, unknown>,
  ) {
    const existing = (await this.getRule(organizationId, ruleId)) as Record<string, unknown>;
    if (existing.organizationId && existing.organizationId !== organizationId) {
      throw new NotFoundException({
        code: "DETECTION_RULE_NOT_FOUND",
        message: "Detection rule not found",
      });
    }
    const rule = await (this.prisma as unknown as { detectionRule: { update: (args: unknown) => Promise<Record<string, unknown>> } }).detectionRule.update({
      where: { id: existing.id as string },
      data: {
        name: (body.name as string) ?? (existing.name as string),
        description: (body.description as string) ?? (existing.description as string),
        configuration: (body.configuration ?? existing.configuration) as unknown,
        severity: (body.severity as string) ?? (existing.severity as string),
        enabled: (body.enabled as boolean) ?? (existing.enabled as boolean),
        version: (existing.version as number) + 1,
        updatedAt: new Date(),
      },
    });
    await (this.audit as unknown as { record: (args: unknown) => Promise<unknown> }).record({
      organizationId,
      actorId: actorId ?? null,
      action: "detection.rule_updated",
      resourceType: "detection_rule",
      resourceId: rule.id,
      metadata: { version: rule.version },
    });
    return rule;
  }

  async listAlerts(organizationId: string, query: Record<string, unknown>) {
    const where: Record<string, unknown> = { organizationId };
    if (query.status) where.status = query.status;
    if (query.severity) where.severity = query.severity;
    const limit = query.limit ? Math.min(Number(query.limit as string), 100) : 50;
    return (this.prisma as unknown as { alert: { findMany: (args: unknown) => Promise<unknown[]> } }).alert.findMany({
      where,
      orderBy: { lastSeenAt: "desc" },
      take: limit,
    });
  }

  async getAlert(organizationId: string, alertId: string) {
    const alert = await (this.prisma as unknown as { alert: { findFirst: (args: unknown) => Promise<Record<string, unknown> | null> }; alertEvent: { findMany: (args: unknown) => Promise<unknown[]> } }).alert.findFirst({
      where: { id: alertId, organizationId },
    });
    if (!alert)
      throw new NotFoundException({
        code: "ALERT_NOT_FOUND",
        message: "Alert not found",
      });
    const events = await (this.prisma as unknown as { alertEvent: { findMany: (args: unknown) => Promise<unknown[]> } }).alertEvent.findMany({
      where: { alertId: alert.id as string },
      include: { event: true },
    });
    return { alert, events };
  }
}
