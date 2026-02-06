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

  cookieConfig: {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: true,
    maxAge: 2592000000, // 30 days in milliseconds (matches refresh token expiration)
    path: "/api/auth",
  },

  maxGlobalAmount: 1000000,
  maxGlobalQuantity: 5000,

  sensitiveKeys: ["password", "token", "secret", "creditCard", "cvv", "auth"],
  basePath: "/api",
} as const;
