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
import type { SoccRequest } from "../common/http.types.js";
import { OrganizationsService } from "./organizations.service.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import {
  addMemberSchema,
  createOrganizationSchema,
  listMembersQuerySchema,
  updateMemberSchema,
} from "../common/schemas.js";
import {
  CurrentOrganization,
  CurrentUser,
  RequirePermissions,
  UseOrganizationContext,
  type OrganizationContext,
} from "../authorization/auth.decorators.js";
import { Permissions } from "../authorization/permissions.js";

type CreateOrganizationBody = { name: string };
type AddMemberBody = { email: string; roles: string[] };
type UpdateMemberBody = { status?: "ACTIVE" | "REVOKED"; roles?: string[] };
type ListMembersQuery = { limit: number; cursor?: string };

@ApiTags("organizations")
@Controller("organizations")
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: "Create an organization; caller becomes OWNER" })
  async createOrganization(
    @CurrentUser() user: { userId: string },
    @Body(new ZodValidationPipe(createOrganizationSchema))
    body: CreateOrganizationBody,
    @Req() req: SoccRequest,
  ) {
    const result = await this.organizations.createOrganization(
      user.userId,
      body.name,
      req.requestId,
    );
    return {
      organization: {
        id: result.organization.id,
        name: result.organization.name,
        status: result.organization.status,
      },
      membershipId: result.membershipId,
      roles: ["OWNER"],
    };
  }

  @Get()
  @ApiOperation({ summary: "List organizations the caller belongs to" })
  async listMine(@CurrentUser() user: { userId: string }) {
    const organizations = await this.organizations.listMyOrganizations(user.userId);
    return { organizations };
  }

  @Get("current")
  @UseOrganizationContext()
  @RequirePermissions(Permissions.ORG_READ)
  @ApiOperation({ summary: "Current organization from X-Organization-Id" })
  async getCurrent(@CurrentOrganization() ctx: OrganizationContext) {
    return this.organizations.getCurrentOrganization(ctx);
  }

  @Get("current/members")
  @UseOrganizationContext()
  @RequirePermissions(Permissions.ORG_MEMBERS_READ)
  @ApiOperation({ summary: "List members of the current organization" })
  async listMembers(
    @CurrentOrganization() ctx: OrganizationContext,
    @Query(new ZodValidationPipe(listMembersQuerySchema))
    query: ListMembersQuery,
  ) {
    return this.organizations.listMembers(ctx, query);
  }

  @Post("current/members")
  @HttpCode(201)
  @UseOrganizationContext()
  @RequirePermissions(Permissions.ORG_MEMBERS_WRITE)
  @ApiOperation({ summary: "Add an existing user as a member" })
  async addMember(
    @CurrentOrganization() ctx: OrganizationContext,
    @Body(new ZodValidationPipe(addMemberSchema)) body: AddMemberBody,
    @Req() req: SoccRequest,
  ) {
    return this.organizations.addMember(ctx, body, req.requestId);
  }

  @Patch("current/members/:membershipId")
  @UseOrganizationContext()
  @RequirePermissions(Permissions.ORG_MEMBERS_WRITE)
  @ApiOperation({ summary: "Update membership status and/or roles" })
  async updateMember(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param("membershipId") membershipId: string,
    @Body(new ZodValidationPipe(updateMemberSchema)) body: UpdateMemberBody,
    @Req() req: SoccRequest,
  ) {
    return this.organizations.updateMember(ctx, membershipId, body, req.requestId);
  }
}
