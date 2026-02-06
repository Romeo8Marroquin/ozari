import winston from "winston";

/**
 * Audit Logger Configuration
 *
 * Purpose: Track security-critical and compliance-related events
 * Deployment: Railway (logs to stdout, captured by Railway's log aggregator)
 *
 * Key Features:
 * - [AUDIT] prefix for easy filtering in Railway logs
 * - Structured JSON in production for searchability
 * - Human-readable format in development
 * - Separate from application logs (different concern)
 *
 * Railway Log Filtering:
 * - Search for "[AUDIT]" in Railway dashboard
 * - Filter by action (e.g., "USER_CREATED", "ROLE_CHANGED")
 * - Filter by userId, email, etc.
 */

const isProduction = process.env["NODE_ENV"] === "production";

// Custom format for audit logs
const auditFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.metadata({
    fillExcept: ["message", "level", "timestamp", "label"],
  }),
  isProduction
    ? // Production: JSON format (structured, searchable in Railway)
      winston.format.json()
    : // Development: Human-readable format
      winston.format.printf(({ level, message, timestamp, metadata }) => {
        const meta =
          metadata && Object.keys(metadata as object).length
            ? `\n${JSON.stringify(metadata, null, 2)}`
            : "";
        return `${timestamp} [AUDIT] ${level.toUpperCase()}: ${message}${meta}`;
      }),
);

// Create audit logger instance
export const auditLogger = winston.createLogger({
  level: "info", // Only info and above for audit logs
  format: auditFormat,
  defaultMeta: {
    service: "ozari-api",
    type: "audit", // Easy filtering in Railway
  },
  transports: [
    // All audit logs to stdout (Railway captures this)
    new winston.transports.Console({
      format: isProduction
        ? winston.format.combine(
            winston.format.label({ label: "[AUDIT]" }),
            winston.format.json(),
          )
        : auditFormat,
    }),
  ],
});

/**
 * Audit Event Types
 * Categorize all auditable actions for consistency
 */
export enum AuditAction {
  // User Management
  USER_CREATED = "USER_CREATED",
  USER_DELETED = "USER_DELETED",
  USER_UPDATED = "USER_UPDATED",
  USER_ROLE_CHANGED = "USER_ROLE_CHANGED",

  // Authentication & Authorization
  USER_LOGIN_SUCCESS = "USER_LOGIN_SUCCESS",
  USER_LOGIN_FAILED = "USER_LOGIN_FAILED",
  USER_LOGOUT = "USER_LOGOUT",
  USER_LOGOUT_ALL_DEVICES = "USER_LOGOUT_ALL_DEVICES",
  TOKEN_REFRESH = "TOKEN_REFRESH",
  MFA_ENABLED = "MFA_ENABLED",
  MFA_DISABLED = "MFA_DISABLED",

  // Security Events
  ACCOUNT_LOCKED = "ACCOUNT_LOCKED",
  PASSWORD_CHANGED = "PASSWORD_CHANGED",
  PASSWORD_RESET_REQUESTED = "PASSWORD_RESET_REQUESTED",
  PASSWORD_RESET_COMPLETED = "PASSWORD_RESET_COMPLETED",
  UNAUTHORIZED_ACCESS_ATTEMPT = "UNAUTHORIZED_ACCESS_ATTEMPT",
  API_KEY_ROTATED = "API_KEY_ROTATED",

  // Data Access
  SENSITIVE_DATA_ACCESSED = "SENSITIVE_DATA_ACCESSED",
  SENSITIVE_DATA_EXPORTED = "SENSITIVE_DATA_EXPORTED",
  BULK_DATA_OPERATION = "BULK_DATA_OPERATION",

  // Administrative Actions
  ADMIN_ACTION = "ADMIN_ACTION",
  PERMISSION_GRANTED = "PERMISSION_GRANTED",
  PERMISSION_REVOKED = "PERMISSION_REVOKED",
}

/**
 * Audit Log Entry Interface
 */
export interface AuditLogEntry {
  action: AuditAction; // What happened
  userId?: number; // Who did it (if authenticated)
  targetUserId?: number; // Who was affected (if applicable)
  email?: string; // User email (for correlation)
  ipAddress?: string; // Request IP
  userAgent?: string; // Request user-agent
  deviceUuid?: string; // Device identifier
  resource?: string; // What resource was affected (e.g., "Product ID 123")
  oldValue?: unknown; // Previous value (for updates)
  newValue?: unknown; // New value (for updates)
  reason?: string; // Why (if applicable)
  success: boolean; // Was the action successful
  errorMessage?: string; // Error if failed
  metadata?: Record<string, unknown>; // Additional context
}

/**
 * Log an audit event
 *
 * @param entry - Structured audit log entry
 *
 * @example
 * ```typescript
 * logAudit({
 *   action: AuditAction.USER_LOGIN_SUCCESS,
 *   userId: user.id,
 *   email: user.email,
 *   ipAddress: req.ip,
 *   deviceUuid: deviceUuid,
 *   success: true,
 * });
 * ```
 */
export function logAudit(entry: AuditLogEntry): void {
  const { action, success, errorMessage, ...metadata } = entry;

  const message = `${action} - ${success ? "SUCCESS" : "FAILED"}${
    errorMessage ? `: ${errorMessage}` : ""
  }`;

  if (success) {
    auditLogger.info(message, metadata);
  } else {
    auditLogger.warn(message, metadata);
  }
}

/**
 * Helper: Log user authentication events
 */
export function logAuthAudit(params: {
  action: AuditAction;
  userId?: number | undefined;
  email: string;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  deviceUuid?: string | undefined;
  success: boolean;
  reason?: string | undefined;
}): void {
  const entry: AuditLogEntry = {
    action: params.action,
    email: params.email,
    success: params.success,
  };

  // Only add optional fields if they are defined
  if (params.userId !== undefined) entry.userId = params.userId;
  if (params.ipAddress !== undefined) entry.ipAddress = params.ipAddress;
  if (params.userAgent !== undefined) entry.userAgent = params.userAgent;
  if (params.deviceUuid !== undefined) entry.deviceUuid = params.deviceUuid;
  if (params.reason !== undefined) entry.errorMessage = params.reason;

  logAudit(entry);
}

/**
 * Helper: Log user management events
 */
export function logUserManagementAudit(params: {
  action: AuditAction;
  userId: number;
  targetUserId?: number | undefined;
  email?: string | undefined;
  ipAddress?: string | undefined;
  oldValue?: unknown;
  newValue?: unknown;
  success: boolean;
  reason?: string | undefined;
}): void {
  const entry: AuditLogEntry = {
    action: params.action,
    userId: params.userId,
    success: params.success,
  };

  // Only add optional fields if they are defined
  if (params.targetUserId !== undefined) entry.targetUserId = params.targetUserId;
  if (params.email !== undefined) entry.email = params.email;
  if (params.ipAddress !== undefined) entry.ipAddress = params.ipAddress;
  if (params.oldValue !== undefined) entry.oldValue = params.oldValue;
  if (params.newValue !== undefined) entry.newValue = params.newValue;
  if (params.reason !== undefined) entry.errorMessage = params.reason;

  logAudit(entry);
}

/**
 * Helper: Log security events
 */
export function logSecurityAudit(params: {
  action: AuditAction;
  userId?: number | undefined;
  email?: string | undefined;
  ipAddress?: string | undefined;
  resource?: string | undefined;
  success: boolean;
  reason?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}): void {
  const entry: AuditLogEntry = {
    action: params.action,
    success: params.success,
  };

  // Only add optional fields if they are defined
  if (params.userId !== undefined) entry.userId = params.userId;
  if (params.email !== undefined) entry.email = params.email;
  if (params.ipAddress !== undefined) entry.ipAddress = params.ipAddress;
  if (params.resource !== undefined) entry.resource = params.resource;
  if (params.reason !== undefined) entry.errorMessage = params.reason;
  if (params.metadata !== undefined) entry.metadata = params.metadata;

  logAudit(entry);
}
