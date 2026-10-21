import { HttpStatus, Injectable } from "@nestjs/common";
import type { Asset, AssetStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { ApiError, ErrorCodes } from "../common/api-error.js";
import type { OrganizationContext } from "../authorization/auth.decorators.js";

export interface AssetView {
  id: string;
  name: string;
  assetType: string;
  hostname: string | null;
  environment: string | null;
  criticality: string | null;
  owner: string | null;
  status: AssetStatus;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAssetInput {
  name: string;
  assetType: string;
  hostname?: string;
  environment?: string;
  criticality?: string;
  owner?: string;
  lastSeenAt?: Date;
}

export interface UpdateAssetInput {
  name?: string;
  assetType?: string;
  hostname?: string;
  environment?: string;
  criticality?: string;
  owner?: string;
  lastSeenAt?: Date;
  status?: AssetStatus;
}

export interface ListAssetsOptions {
  limit: number;
  cursor?: string;
  status?: AssetStatus;
  assetType?: string;
  search?: string;
}

function toView(asset: Asset): AssetView {
  return {
    id: asset.id,
    name: asset.name,
    assetType: asset.assetType,
    hostname: asset.hostname,
    environment: asset.environment,
    criticality: asset.criticality,
    owner: asset.owner,
    status: asset.status,
    lastSeenAt: asset.lastSeenAt?.toISOString() ?? null,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
  };
}

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    ctx: OrganizationContext,
    options: ListAssetsOptions,
  ): Promise<{ assets: AssetView[]; nextCursor: string | null }> {
    return this.prisma.runWithTenant(ctx, async (tx) => {
      const rows = await tx.asset.findMany({
        where: {
          organizationId: ctx.organizationId,
          ...(options.status ? { status: options.status } : {}),
          ...(options.assetType ? { assetType: options.assetType } : {}),
          ...(options.search
            ? {
                OR: [
                  { name: { contains: options.search, mode: "insensitive" } },
                  { hostname: { contains: options.search, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: options.limit + 1,
        ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, options.limit);
      return {
        assets: page.map(toView),
        nextCursor: rows.length > options.limit ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }

  async get(ctx: OrganizationContext, assetId: string): Promise<AssetView> {
    return this.prisma.runWithTenant(ctx, async (tx) => {
      const asset = await tx.asset.findFirst({
        where: { id: assetId, organizationId: ctx.organizationId },
      });
      if (!asset) {
        throw new ApiError(
          HttpStatus.NOT_FOUND,
          ErrorCodes.ASSET_NOT_FOUND,
          "Asset not found.",
        );
      }
      return toView(asset);
    });
  }

  async create(
    ctx: OrganizationContext,
    input: CreateAssetInput,
    requestId?: string,
  ): Promise<AssetView> {
    return this.prisma.runWithTenant(ctx, async (tx) => {
      const asset = await tx.asset.create({
        data: {
          organizationId: ctx.organizationId,
          name: input.name,
          assetType: input.assetType,
          hostname: input.hostname ?? null,
          environment: input.environment ?? null,
          criticality: input.criticality ?? null,
          owner: input.owner ?? null,
          lastSeenAt: input.lastSeenAt ?? null,
        },
      });
      await this.audit.recordInTx(tx, {
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        action: "asset.created",
        resourceType: "asset",
        resourceId: asset.id,
        metadata: { assetType: asset.assetType, name: asset.name },
        requestId: requestId ?? null,
      });
      return toView(asset);
    });
  }

  async update(
    ctx: OrganizationContext,
    assetId: string,
    input: UpdateAssetInput,
    requestId?: string,
  ): Promise<AssetView> {
    return this.prisma.runWithTenant(ctx, async (tx) => {
      const existing = await tx.asset.findFirst({
        where: { id: assetId, organizationId: ctx.organizationId },
      });
      if (!existing) {
        throw new ApiError(
          HttpStatus.NOT_FOUND,
          ErrorCodes.ASSET_NOT_FOUND,
          "Asset not found.",
        );
      }

      const asset = await tx.asset.update({
        where: { id: existing.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.assetType !== undefined ? { assetType: input.assetType } : {}),
          ...(input.hostname !== undefined ? { hostname: input.hostname } : {}),
          ...(input.environment !== undefined ? { environment: input.environment } : {}),
          ...(input.criticality !== undefined ? { criticality: input.criticality } : {}),
          ...(input.owner !== undefined ? { owner: input.owner } : {}),
          ...(input.lastSeenAt !== undefined ? { lastSeenAt: input.lastSeenAt } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });

      const changedFields = Object.keys(input).sort();
      await this.audit.recordInTx(tx, {
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        action:
          input.status === "INACTIVE" && existing.status !== "INACTIVE"
            ? "asset.deactivated"
            : "asset.updated",
        resourceType: "asset",
        resourceId: asset.id,
        metadata: { changedFields },
        requestId: requestId ?? null,
      });
      return toView(asset);
    });
  }
}
