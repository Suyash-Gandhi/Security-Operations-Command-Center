import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { SoccRequest } from "../common/http.types.js";
import { ApiError, ErrorCodes } from "../common/api-error.js";
import { Public } from "../authorization/auth.decorators.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { idempotencyKeySchema } from "../common/schemas.js";
import { ingestEnvelopeSchema, type IngestEnvelope } from "./ingestion.schemas.js";
import { EventSourcesService } from "../event-sources/event-sources.service.js";
import { IngestionService } from "./ingestion.service.js";

function extractBearerToken(authorization: string | undefined): string {
  if (!authorization) {
    throw new ApiError(
      HttpStatus.UNAUTHORIZED,
      ErrorCodes.SOURCE_AUTH_FAILED,
      "Source authentication failed.",
    );
  }
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  if (!match?.[1]) {
    throw new ApiError(
      HttpStatus.UNAUTHORIZED,
      ErrorCodes.SOURCE_AUTH_FAILED,
      "Source authentication failed.",
    );
  }
  return match[1];
}

@ApiTags("ingestion")
@Controller("events")
@Public()
export class IngestionController {
  constructor(
    private readonly sources: EventSourcesService,
    private readonly ingestion: IngestionService,
  ) {}

  @Post("ingest")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: "Ingest one or more validated events from an authenticated source",
  })
  async ingest(
    @Headers("authorization") authorization: string | undefined,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(ingestEnvelopeSchema)) body: IngestEnvelope,
    @Req() req: SoccRequest,
  ) {
    const token = extractBearerToken(authorization);
    const source = await this.sources.authenticateSource(token);

    let idempotencyKey: string | undefined;
    if (rawIdempotencyKey !== undefined) {
      const parsed = idempotencyKeySchema.safeParse(rawIdempotencyKey);
      if (!parsed.success) {
        throw new ApiError(
          HttpStatus.BAD_REQUEST,
          ErrorCodes.VALIDATION_ERROR,
          "Invalid Idempotency-Key header.",
          { issues: parsed.error.issues.map((issue) => issue.message) },
        );
      }
      idempotencyKey = parsed.data;
    }

    return this.ingestion.ingest(source, body, idempotencyKey, req.requestId);
  }
}
