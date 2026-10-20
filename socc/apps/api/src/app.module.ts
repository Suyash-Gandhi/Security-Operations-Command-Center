import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { validateEnv } from "./config/env.validation.js";
import { AppConfigModule } from "./config/app-config.module.js";
import { JsonLoggerService } from "./logger/json-logger.service.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { RequestIdMiddleware } from "./common/request-id.middleware.js";
import { LoginThrottleService } from "./common/login-throttle.service.js";
import { AuditService } from "./audit/audit.service.js";
import { SessionService } from "./auth/session.service.js";
import { PasswordService } from "./auth/password.service.js";
import { AuthService } from "./auth/auth.service.js";
import { AuthController } from "./auth/auth.controller.js";
import { SessionAuthGuard } from "./auth/guards/session-auth.guard.js";
import { OriginGuard } from "./auth/guards/origin.guard.js";
import { OrganizationsService } from "./organizations/organizations.service.js";
import { OrganizationsController } from "./organizations/organizations.controller.js";
import { OrganizationContextGuard } from "./authorization/organization-context.guard.js";
import { PermissionsGuard } from "./authorization/permissions.guard.js";
import { HealthController } from "./health/health.controller.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (raw: NodeJS.ProcessEnv) => validateEnv(raw),
    }),
    AppConfigModule,
    PrismaModule,
  ],
  controllers: [HealthController, AuthController, OrganizationsController],
  providers: [
    JsonLoggerService,
    LoginThrottleService,
    AuditService,
    SessionService,
    PasswordService,
    AuthService,
    OrganizationsService,
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: OrganizationContextGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}
