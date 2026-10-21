import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import { Catch, HttpException, HttpStatus } from "@nestjs/common";
import type { Request, Response } from "express";
import { ZodError } from "zod";
import { ApiError, ErrorCodes, type ErrorEnvelope } from "./api-error.js";
import { JsonLoggerService } from "../logger/json-logger.service.js";

/**
 * Maps every thrown error to the documented API error envelope:
 * { code, message, requestId, details? }.
 *
 * Never returns stack traces, SQL, or secret values to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: JsonLoggerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const requestId =
      (request.headers["x-request-id"] as string | undefined) ?? "unknown";

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrorCodes.INTERNAL_ERROR;
    let message = "An unexpected error occurred.";
    let details: unknown;

    if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      code = ErrorCodes.VALIDATION_ERROR;
      message = "Request validation failed.";
      details = exception.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
    } else if (exception instanceof ApiError) {
      status = exception.getStatus();
      code = exception.code;
      const body = exception.getResponse() as { message?: string; details?: unknown };
      message = typeof body.message === "string" ? body.message : exception.message;
      details = body.details;
    } else if (
      exception instanceof HttpException &&
      exception.getStatus() === HttpStatus.PAYLOAD_TOO_LARGE
    ) {
      status = HttpStatus.PAYLOAD_TOO_LARGE;
      code = ErrorCodes.PAYLOAD_TOO_LARGE;
      message = "Request payload is too large.";
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === "object" && body !== null && "code" in body) {
        const b = body as { code?: string; message?: string; details?: unknown };
        code = b.code ?? String(status);
        message = b.message ?? exception.message;
        details = b.details;
      } else {
        code = String(status);
        message = status < 500 ? exception.message : "An unexpected error occurred.";
      }
    } else {
      this.logger.error(
        "Unhandled exception",
        exception instanceof Error ? exception.stack : undefined,
        "AllExceptionsFilter",
        { requestId, path: request.url, method: request.method },
      );
    }

    const envelope: ErrorEnvelope = { code, message, requestId };
    if (details !== undefined) {
      envelope.details = details;
    }
    response.status(status).json(envelope);
  }
}
