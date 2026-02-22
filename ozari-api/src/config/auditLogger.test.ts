import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AuditAction,
  logAudit,
  logAuthAudit,
  logUserManagementAudit,
  logSecurityAudit,
  auditLogger,
} from "./auditLogger.js";

vi.spyOn(auditLogger, "info");
vi.spyOn(auditLogger, "warn");

describe("Audit Logger", () => {
  const originalNodeEnv = process.env["NODE_ENV"];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalNodeEnv) {
      process.env["NODE_ENV"] = originalNodeEnv;
    }
  });

  describe("logAudit", () => {
    it("should log successful action", () => {
      logAudit({
        action: AuditAction.USER_LOGIN_SUCCESS,
        userId: 1,
        email: "test@example.com",
        success: true,
      });

      expect(auditLogger.info).toHaveBeenCalledWith(
        "USER_LOGIN_SUCCESS - SUCCESS",
        expect.objectContaining({
          userId: 1,
          email: "test@example.com",
        }),
      );
    });

    it("should log failed action", () => {
      logAudit({
        action: AuditAction.USER_LOGIN_FAILED,
        email: "test@example.com",
        success: false,
        errorMessage: "Invalid credentials",
      });

      expect(auditLogger.warn).toHaveBeenCalledWith(
        "USER_LOGIN_FAILED - FAILED: Invalid credentials",
        expect.objectContaining({
          email: "test@example.com",
        }),
      );
    });

    it("should include all metadata fields", () => {
      logAudit({
        action: AuditAction.SENSITIVE_DATA_ACCESSED,
        userId: 1,
        targetUserId: 2,
        email: "admin@example.com",
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0",
        deviceUuid: "device-123",
        resource: "User Profile #2",
        success: true,
        metadata: {
          dataType: "personal_info",
        },
      });

      expect(auditLogger.info).toHaveBeenCalledWith(
        "SENSITIVE_DATA_ACCESSED - SUCCESS",
        expect.objectContaining({
          userId: 1,
          targetUserId: 2,
          email: "admin@example.com",
          ipAddress: "192.168.1.1",
          userAgent: "Mozilla/5.0",
          deviceUuid: "device-123",
          resource: "User Profile #2",
          metadata: {
            dataType: "personal_info",
          },
        }),
      );
    });
  });

  describe("logAuthAudit", () => {
    it("should log authentication event with all fields", () => {
      logAuthAudit({
        action: AuditAction.USER_LOGIN_SUCCESS,
        userId: 1,
        email: "user@example.com",
        ipAddress: "192.168.1.1",
        userAgent: "Chrome",
        deviceUuid: "device-123",
        success: true,
      });

      expect(auditLogger.info).toHaveBeenCalledWith(
        "USER_LOGIN_SUCCESS - SUCCESS",
        expect.objectContaining({
          userId: 1,
          email: "user@example.com",
          ipAddress: "192.168.1.1",
          userAgent: "Chrome",
          deviceUuid: "device-123",
        }),
      );
    });

    it("should log failed authentication with reason", () => {
      logAuthAudit({
        action: AuditAction.USER_LOGIN_FAILED,
        email: "user@example.com",
        success: false,
        reason: "Invalid password",
      });

      expect(auditLogger.warn).toHaveBeenCalledWith(
        "USER_LOGIN_FAILED - FAILED: Invalid password",
        expect.objectContaining({
          email: "user@example.com",
        }),
      );
    });

    it("should handle optional fields correctly", () => {
      logAuthAudit({
        action: AuditAction.USER_LOGOUT,
        email: "user@example.com",
        success: true,
      });

      expect(auditLogger.info).toHaveBeenCalledWith(
        "USER_LOGOUT - SUCCESS",
        expect.objectContaining({
          email: "user@example.com",
        }),
      );
    });
  });

  describe("logUserManagementAudit", () => {
    it("should log user creation", () => {
      logUserManagementAudit({
        action: AuditAction.USER_CREATED,
        userId: 1,
        targetUserId: 2,
        email: "newuser@example.com",
        ipAddress: "192.168.1.1",
        success: true,
      });

      expect(auditLogger.info).toHaveBeenCalledWith(
        "USER_CREATED - SUCCESS",
        expect.objectContaining({
          userId: 1,
          targetUserId: 2,
          email: "newuser@example.com",
          ipAddress: "192.168.1.1",
        }),
      );
    });

    it("should log role change with old and new values", () => {
      logUserManagementAudit({
        action: AuditAction.USER_ROLE_CHANGED,
        userId: 1,
        targetUserId: 2,
        email: "user@example.com",
        oldValue: "CLIENT",
        newValue: "ADMIN",
        success: true,
      });

      expect(auditLogger.info).toHaveBeenCalledWith(
        "USER_ROLE_CHANGED - SUCCESS",
        expect.objectContaining({
          userId: 1,
          targetUserId: 2,
          email: "user@example.com",
          oldValue: "CLIENT",
          newValue: "ADMIN",
        }),
      );
    });

    it("should log failed user deletion with reason", () => {
      logUserManagementAudit({
        action: AuditAction.USER_DELETED,
        userId: 1,
        targetUserId: 2,
        success: false,
        reason: "User has active sessions",
      });

      expect(auditLogger.warn).toHaveBeenCalledWith(
        "USER_DELETED - FAILED: User has active sessions",
        expect.objectContaining({
          userId: 1,
          targetUserId: 2,
        }),
      );
    });

    it("should handle missing optional fields", () => {
      logUserManagementAudit({
        action: AuditAction.USER_UPDATED,
        userId: 1,
        success: true,
      });

      expect(auditLogger.info).toHaveBeenCalledWith(
        "USER_UPDATED - SUCCESS",
        expect.objectContaining({
          userId: 1,
        }),
      );
    });

    it("should handle missing targetUserId", () => {
      logUserManagementAudit({
        action: AuditAction.USER_UPDATED,
        userId: 1,
        email: "test@example.com",
        success: true,
      });

      expect(auditLogger.info).toHaveBeenCalledWith(
        "USER_UPDATED - SUCCESS",
        expect.objectContaining({
          userId: 1,
          email: "test@example.com",
        }),
      );
    });

    it("should handle missing email", () => {
      logUserManagementAudit({
        action: AuditAction.USER_UPDATED,
        userId: 1,
        targetUserId: 2,
        success: true,
      });

      expect(auditLogger.info).toHaveBeenCalledWith(
        "USER_UPDATED - SUCCESS",
        expect.objectContaining({
          userId: 1,
          targetUserId: 2,
        }),
      );
    });

    it("should handle missing ipAddress", () => {
      logUserManagementAudit({
        action: AuditAction.USER_UPDATED,
        userId: 1,
        email: "test@example.com",
        success: true,
      });

      expect(auditLogger.info).toHaveBeenCalledWith(
        "USER_UPDATED - SUCCESS",
        expect.objectContaining({
          userId: 1,
          email: "test@example.com",
        }),
      );
    });

    it("should handle missing oldValue", () => {
      logUserManagementAudit({
        action: AuditAction.USER_ROLE_CHANGED,
        userId: 1,
        targetUserId: 2,
        newValue: "ADMIN",
        success: true,
      });

      expect(auditLogger.info).toHaveBeenCalledWith(
        "USER_ROLE_CHANGED - SUCCESS",
        expect.objectContaining({
          userId: 1,
          targetUserId: 2,
          newValue: "ADMIN",
        }),
      );
    });

    it("should handle missing newValue", () => {
      logUserManagementAudit({
        action: AuditAction.USER_ROLE_CHANGED,
        userId: 1,
        targetUserId: 2,
        oldValue: "CLIENT",
        success: true,
      });

      expect(auditLogger.info).toHaveBeenCalledWith(
        "USER_ROLE_CHANGED - SUCCESS",
        expect.objectContaining({
          userId: 1,
          targetUserId: 2,
          oldValue: "CLIENT",
        }),
      );
    });

    it("should handle missing reason", () => {
      logUserManagementAudit({
        action: AuditAction.USER_UPDATED,
        userId: 1,
        success: true,
      });

      expect(auditLogger.info).toHaveBeenCalledWith(
        "USER_UPDATED - SUCCESS",
        expect.objectContaining({
          userId: 1,
        }),
      );
    });
  });

  describe("logSecurityAudit", () => {
    it("should log security event", () => {
      logSecurityAudit({
        action: AuditAction.ACCOUNT_LOCKED,
        email: "user@example.com",
        ipAddress: "192.168.1.1",
        success: true,
        reason: "Too many failed attempts",
        metadata: {
          attempts: 5,
          remainingMinutes: 15,
        },
      });

      expect(auditLogger.info).toHaveBeenCalledWith(
        "ACCOUNT_LOCKED - SUCCESS: Too many failed attempts",
        expect.objectContaining({
          email: "user@example.com",
          ipAddress: "192.168.1.1",
          metadata: {
            attempts: 5,
            remainingMinutes: 15,
          },
        }),
      );
    });

    it("should log unauthorized access attempt", () => {
      logSecurityAudit({
        action: AuditAction.UNAUTHORIZED_ACCESS_ATTEMPT,
        userId: 1,
        resource: "/admin/users",
        ipAddress: "192.168.1.1",
        success: false,
        reason: "Insufficient permissions",
      });

      expect(auditLogger.warn).toHaveBeenCalledWith(
        "UNAUTHORIZED_ACCESS_ATTEMPT - FAILED: Insufficient permissions",
        expect.objectContaining({
          userId: 1,
          resource: "/admin/users",
          ipAddress: "192.168.1.1",
        }),
      );
    });

    it("should log password change", () => {
      logSecurityAudit({
        action: AuditAction.PASSWORD_CHANGED,
        userId: 1,
        email: "user@example.com",
        success: true,
      });

      expect(auditLogger.info).toHaveBeenCalledWith(
        "PASSWORD_CHANGED - SUCCESS",
        expect.objectContaining({
          userId: 1,
          email: "user@example.com",
        }),
      );
    });
  });

  describe("AuditAction enum", () => {
    it("should have all required action types", () => {
      expect(AuditAction.USER_CREATED).toBe("USER_CREATED");
      expect(AuditAction.USER_LOGIN_SUCCESS).toBe("USER_LOGIN_SUCCESS");
      expect(AuditAction.ACCOUNT_LOCKED).toBe("ACCOUNT_LOCKED");
      expect(AuditAction.PASSWORD_CHANGED).toBe("PASSWORD_CHANGED");
      expect(AuditAction.ADMIN_ACTION).toBe("ADMIN_ACTION");
    });
  });
});
