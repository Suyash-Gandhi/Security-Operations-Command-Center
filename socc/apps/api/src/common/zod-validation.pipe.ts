import { HttpStatus, Injectable, type PipeTransform } from "@nestjs/common";
import type { ZodError } from "zod";
import { type ZodType } from "zod";
import { ApiError, ErrorCodes } from "./api-error.js";

/**
 * Validates a request fragment against a Zod schema at the framework
 * boundary. Field paths are reported; field VALUES are never echoed.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        ErrorCodes.VALIDATION_ERROR,
        "Request validation failed.",
        (result.error as ZodError).issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      );
    }
    return result.data;
  }
}
