import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module.js";
import { AppConfigService } from "./config/app-config.service.js";
import { JsonLoggerService } from "./logger/json-logger.service.js";
import { AllExceptionsFilter } from "./common/all-exceptions.filter.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(AppConfigService);
  const logger = app.get(JsonLoggerService);

  app.useLogger(logger);
  app.use(cookieParser());
  app.setGlobalPrefix("v1", { exclude: ["health", "health/ready"] });
  app.enableCors({
    origin(
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) {
      if (!origin || config.allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  });
  app.useGlobalFilters(new AllExceptionsFilter(logger));
  app.enableShutdownHooks();

  await app.listen(config.port, "0.0.0.0");
  logger.log(`SOCC API listening on port ${config.port}`, "Bootstrap");
}

void bootstrap();
