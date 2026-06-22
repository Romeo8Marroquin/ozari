import { isDeployedEnvironment } from "./environment.js";

export const appConfig = {
  accessToken: {
    algorithm: "HS256" as const,
    audience: "platform-users",
    expiresIn: 900, // 15 minutes in seconds
    issuer: "ozari",
  },

  refreshToken: {
    algorithm: "HS256" as const,
    audience: "platform-users",
    expiresIn: 2592000, // 30 days in seconds
    issuer: "ozari",
  },

  mfaToken: {
    algorithm: "HS256" as const,
    audience: "platform-users",
    expiresIn: 300, // 5 minutes in seconds
    issuer: "ozari",
  },

  mfa: {
    issuerLabel: "Ozari",
    secretBytes: 20,
    totpDigits: 6,
    totpStepSeconds: 30,
    totpWindow: 1,
    recoveryCodeCount: 10,
  },

  cookieConfig: {
    httpOnly: true,
    sameSite: isDeployedEnvironment() ? ("none" as const) : ("lax" as const),
    secure: isDeployedEnvironment(),
    maxAge: 2592000000, // 30 days in milliseconds (matches refresh token expiration)
    path: "/api/auth",
  },

  maxGlobalAmount: 1000000,
  maxGlobalQuantity: 5000,

  sensitiveKeys: ["password", "token", "secret", "creditCard", "cvv", "auth"],
  basePath: "/api",
} as const;
