import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import { AppConfigService } from "../config/app-config.service.js";

export interface TenantIdentity {
  userId: string;
  organizationId: string;
}

/**
 * Prisma client bound to the least-privilege `socc_app` database role.
 *
 * PostgreSQL RLS policies are enforced for this role. Tenant-scoped access
 * must go through runWithTenant()/runWithUser(), which set transaction-local
 * GUCs (`app.current_user_id`, `app.current_organization_id`) consumed by the
 * RLS policies as defense in depth behind application-level authorization.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: AppConfigService) {
    super({ datasourceUrl: config.appDatabaseUrl });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Runs work inside a transaction with transaction-local tenant context:
   * both the authenticated user and the verified organization are exposed to
   * RLS policies for the duration of the transaction only.
   */
  async runWithTenant<T>(
    identity: TenantIdentity,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await this.setTenantContext(tx, identity.userId, identity.organizationId);
      return fn(tx);
    });
  }

  /**
   * Runs work with only the verified organization GUC set. Used for writes
   * that belong to an organization but have no actor (e.g. system audit
   * entries).
   */
  async runWithOrg<T>(
    organizationId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_organization_id', ${organizationId}, true)`;
      return fn(tx);
    });
  }

  /**
   * Runs work with only the presented source-credential digest GUC set.
   *
   * Event-source authentication happens before an organization context is
   * known. The EventSource RLS policy permits selecting exactly the row whose
   * stored credential hash matches this transaction-local value, so the
   * runtime role can authenticate a source without being able to enumerate or
   * read any other source.
   */
  async runWithSourceCredential<T>(
    credentialHash: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_source_credential_hash', ${credentialHash}, true)`;
      return fn(tx);
    });
  }

  /**
   * Runs work with only the authenticated-user GUC set. Used before an
   * organization context exists (e.g. listing a user's own memberships).
   */
  async runWithUser<T>(
    userId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
      return fn(tx);
    });
  }

  private async setTenantContext(
    tx: Prisma.TransactionClient,
    userId: string,
    organizationId: string,
  ): Promise<void> {
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
    await tx.$executeRaw`SELECT set_config('app.current_organization_id', ${organizationId}, true)`;
  }
}
