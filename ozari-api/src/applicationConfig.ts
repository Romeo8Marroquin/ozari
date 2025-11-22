export const applicationConfig = {
  accessToken: {
    algorithm: 'HS256',
    audience: 'platform-users',
    expiresIn: 900, // 15 minutes in seconds
    issuer: 'ozari',
  },
  cookieConfig: {
    httpOnly: true,
    sameSite: true,
    secure: true,
  },
  maxGlobalAmount: 1000000,
  maxGlobalQuantity: 5000,
  refreshToken: {
    algorithm: 'HS256',
    audience: 'platform-users',
    expiresIn: 2592000, // 30 days in seconds
    issuer: 'ozari',
  },
  sensitiveKeys: ['password', 'token', 'secret', 'creditCard', 'cvv', 'auth'],
  basePath: '/api',
};
