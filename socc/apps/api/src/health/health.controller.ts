import { Controller, Get, HttpStatus } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../prisma/prisma.service.js";
import { Public } from "../authorization/auth.decorators.js";
import { ApiError, ErrorCodes } from "../common/api-error.js";

@ApiTags("health")
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get("health")
  @ApiOperation({ summary: "Liveness probe (no secrets)" })
  liveness(): { status: string; service: string } {
    return { status: "ok", service: "socc-api" };
  }

  @Public()
  @Get("health/ready")
  @ApiOperation({ summary: "Readiness probe including database connectivity" })
  async readiness(): Promise<{ status: string; database: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: "ok", database: "up" };
    } catch {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCodes.SERVICE_UNAVAILABLE,
        "A required dependency is unavailable.",
      );
    }
  }
}
