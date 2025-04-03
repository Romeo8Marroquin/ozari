export const applicationConfig = {
  accessToken: {
    algorithm: 'HS256',
    audience: 'platform-users',
    expiresIn: '15min',
    issuer: 'ozari',
  },
  cookieConfig: {
    httpOnly: true,
    sameSite: true,
    secure: true,
  },
  refreshToken: {
    algorithm: 'HS256',
    audience: 'platform-users',
    expiresIn: '7d',
    issuer: 'ozari',
  },
};
