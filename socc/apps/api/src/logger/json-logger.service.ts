import type { LoggerService, LogLevel } from "@nestjs/common";
import { Injectable } from "@nestjs/common";
import { AppConfigService } from "../config/app-config.service.js";

const LEVEL_ORDER: Record<LogLevel, number> = {
  verbose: 0,
  debug: 1,
  log: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

/**
 * Minimal structured JSON logger. Avoids extra dependencies while giving
 * operators machine-parseable, single-line JSON logs. Never logs secrets:
 * callers are responsible for not passing sensitive values.
 */
@Injectable()
export class JsonLoggerService implements LoggerService {
  private readonly minLevel: number;

  constructor(config: AppConfigService) {
    const map: Record<string, number> = {
      debug: LEVEL_ORDER.debug,
      info: LEVEL_ORDER.log,
      warn: LEVEL_ORDER.warn,
      error: LEVEL_ORDER.error,
    };
    this.minLevel = map[config.logLevel] ?? LEVEL_ORDER.log;
  }

  private write(
    level: LogLevel,
    message: unknown,
    context?: string,
    extra?: unknown,
  ): void {
    if ((LEVEL_ORDER[level] ?? 0) < this.minLevel) return;
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      context: context ?? "app",
      message: typeof message === "string" ? message : JSON.stringify(message),
      ...(extra !== undefined && extra !== null
        ? { extra: typeof extra === "object" ? extra : { detail: String(extra) } }
        : {}),
    };
    const line = JSON.stringify(entry);
    if (level === "error" || level === "fatal") {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  }

  log(message: unknown, context?: string): void {
    this.write("log", message, context);
  }

  error(message: unknown, trace?: string, context?: string, extra?: unknown): void {
    this.write(
      "error",
      message,
      context,
      trace || extra !== undefined ? { trace, extra } : undefined,
    );
  }

  warn(message: unknown, context?: string): void {
    this.write("warn", message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write("debug", message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write("verbose", message, context);
  }
}
