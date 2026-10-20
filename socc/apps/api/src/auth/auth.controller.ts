import { Body, Controller, Get, HttpCode, Ip, Post, Req, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import type { SoccRequest } from "../common/http.types.js";
import { AuthService } from "./auth.service.js";
import { LoginThrottleService } from "../common/login-throttle.service.js";
import { AppConfigService } from "../config/app-config.service.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { loginSchema, registerSchema } from "../common/schemas.js";
import { clearSessionCookie, setSessionCookie } from "./session-cookie.js";
import { CurrentUser, Public } from "../authorization/auth.decorators.js";

type RegisterBody = {
  email: string;
  password: string;
  displayName: string;
  organizationName: string;
};

type LoginBody = {
  email: string;
  password: string;
};

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly throttle: LoginThrottleService,
    private readonly config: AppConfigService,
  ) {}

  @Public()
  @Post("register")
  @HttpCode(201)
  @ApiOperation({ summary: "Register a user, first organization, and session" })
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterBody,
    @Req() req: SoccRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.register(body, {
      userAgent: req.headers["user-agent"],
      requestId: req.requestId,
    });
    setSessionCookie(res, result.token, this.config, this.config.sessionTtlMs);
    return {
      user: {
        id: result.user.id,
        email: result.user.normalizedEmail,
        displayName: result.user.displayName,
      },
      organization: { id: result.organization.id, name: result.organization.name },
    };
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  @ApiOperation({ summary: "Authenticate with email and password" })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginBody,
    @Ip() ip: string,
    @Req() req: SoccRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const throttleKey = `${ip}:${body.email}`;
    this.throttle.check(throttleKey);

    const result = await this.auth.login(body.email, body.password, {
      userAgent: req.headers["user-agent"],
      requestId: req.requestId,
    });
    if (!result) {
      this.throttle.recordFailure(throttleKey);
      this.auth.throwInvalidCredentials();
    }

    this.throttle.reset(throttleKey);
    setSessionCookie(res, result.token, this.config, this.config.sessionTtlMs);
    return {
      user: {
        id: result.user.id,
        email: result.user.normalizedEmail,
        displayName: result.user.displayName,
      },
    };
  }

  @Post("logout")
  @HttpCode(204)
  @ApiOperation({ summary: "Revoke the current session" })
  async logout(
    @CurrentUser() user: { userId: string; sessionId: string },
    @Req() req: SoccRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(user.userId, user.sessionId, {
      requestId: req.requestId,
    });
    clearSessionCookie(res, this.config);
  }

  @Get("me")
  @ApiOperation({ summary: "Current user with memberships and roles" })
  async me(@CurrentUser() user: { userId: string }) {
    return this.auth.me(user.userId);
  }
}
