import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AssetStatus } from "@prisma/client";
import type { SoccRequest } from "../common/http.types.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import {
  createAssetSchema,
  listAssetsQuerySchema,
  updateAssetSchema,
  uuidParamSchema,
} from "../common/schemas.js";
import {
  CurrentOrganization,
  RequirePermissions,
  UseOrganizationContext,
  type OrganizationContext,
} from "../authorization/auth.decorators.js";
import { Permissions } from "../authorization/permissions.js";
import { AssetsService } from "./assets.service.js";

type CreateAssetBody = {
  name: string;
  assetType: string;
  hostname?: string;
  environment?: string;
  criticality?: string;
  owner?: string;
  lastSeenAt?: Date;
};

type UpdateAssetBody = Partial<CreateAssetBody> & { status?: AssetStatus };

type ListAssetsQuery = {
  limit: number;
  cursor?: string;
  status?: AssetStatus;
  assetType?: string;
  search?: string;
};

@ApiTags("assets")
@Controller("assets")
@UseOrganizationContext()
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  @RequirePermissions(Permissions.ASSETS_READ)
  @ApiOperation({ summary: "List assets in the current organization" })
  async list(
    @CurrentOrganization() ctx: OrganizationContext,
    @Query(new ZodValidationPipe(listAssetsQuerySchema)) query: ListAssetsQuery,
  ) {
    return this.assets.list(ctx, query);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions(Permissions.ASSETS_WRITE)
  @ApiOperation({ summary: "Create an asset in the current organization" })
  async create(
    @CurrentOrganization() ctx: OrganizationContext,
    @Body(new ZodValidationPipe(createAssetSchema)) body: CreateAssetBody,
    @Req() req: SoccRequest,
  ) {
    return this.assets.create(ctx, body, req.requestId);
  }

  @Get(":assetId")
  @RequirePermissions(Permissions.ASSETS_READ)
  @ApiOperation({ summary: "Get one asset in the current organization" })
  async get(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param("assetId", new ZodValidationPipe(uuidParamSchema)) assetId: string,
  ) {
    return this.assets.get(ctx, assetId);
  }

  @Patch(":assetId")
  @RequirePermissions(Permissions.ASSETS_WRITE)
  @ApiOperation({ summary: "Update or deactivate an asset" })
  async update(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param("assetId", new ZodValidationPipe(uuidParamSchema)) assetId: string,
    @Body(new ZodValidationPipe(updateAssetSchema)) body: UpdateAssetBody,
    @Req() req: SoccRequest,
  ) {
    return this.assets.update(ctx, assetId, body, req.requestId);
  }
}
