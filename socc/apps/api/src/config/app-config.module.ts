import { Global, Module } from "@nestjs/common";
import { AppConfigService } from "./app-config.service.js";

/**
 * Globally exports the validated application configuration so that any
 * module (including PrismaModule) can depend on it without importing a
 * config module explicitly.
 */
@Global()
@Module({
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
