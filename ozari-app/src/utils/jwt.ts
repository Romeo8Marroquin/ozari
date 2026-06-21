import { jwtDecode } from 'jwt-decode';
import type { JwtPayload } from '../types/api.types';

/**
 * Decodes a JWT token without verifying signature
 * (Frontend can't verify signature - that's backend's job)
 */
export function decodeToken(token: string): JwtPayload | null {
  try {
    return jwtDecode<JwtPayload>(token);
  } catch (error) {
    console.error('Failed to decode JWT:', error);
    return null;
  }
}

/**
 * Checks if a JWT token is expired
 * @param token - JWT token string
 * @returns true if token is expired or invalid
 */
export function isTokenExpired(token: string): boolean {
  const decoded = decodeToken(token);
  if (!decoded || !decoded.exp) return true;

  // exp is in seconds, Date.now() is in milliseconds
  const now = Math.floor(Date.now() / 1000);
  return decoded.exp <= now;
}

/**
 * Validates if a token exists and is not expired
 * @param token - JWT token string or null
 * @returns true if token is valid and not expired
 */
export function isTokenValid(token: string | null): boolean {
  if (!token) return false;
  return !isTokenExpired(token);
}

/**
 * Gets the time remaining until token expiration in seconds
 * @param token - JWT token string
 * @returns seconds until expiration, or 0 if expired/invalid
 */
export function getTokenTimeRemaining(token: string): number {
  const decoded = decodeToken(token);
  if (!decoded || !decoded.exp) return 0;

  const now = Math.floor(Date.now() / 1000);
  const remaining = decoded.exp - now;
  return remaining > 0 ? remaining : 0;
}

/**
 * Gets the expiration date of a token
 * @param token - JWT token string
 * @returns Date object or null if invalid
 */
export function getTokenExpiration(token: string): Date | null {
  const decoded = decodeToken(token);
  if (!decoded || !decoded.exp) return null;
  return new Date(decoded.exp * 1000);
}
