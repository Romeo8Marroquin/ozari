import { isDeployedEnvironment } from "@/config/environment.js";
import { logger } from "@/config/logger.js";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/**
 * Development adapter: writes the message (including any link/code) to the
 * application logs so flows can be tested locally without a provider. Never
 * used in deployed environments, where logs are shared and must not contain
 * delivery secrets.
 */
class LogMailer implements Mailer {
  send(message: MailMessage): Promise<void> {
    logger.info("[mailer:log] Outgoing email (development only)", {
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    return Promise.resolve();
  }
}

/**
 * Deployed fallback used until a real provider (e.g. ResendMailer over fetch)
 * is configured. It deliberately drops the message and logs a warning WITHOUT
 * any recipient-facing token, so secrets never reach deployed logs.
 */
class NoopMailer implements Mailer {
  send(message: MailMessage): Promise<void> {
    logger.warn("[mailer:noop] Email delivery is not configured; skipping send", {
      subject: message.subject,
    });
    return Promise.resolve();
  }
}

let mailer: Mailer | null = null;

export function getMailer(): Mailer {
  mailer ??= isDeployedEnvironment() ? new NoopMailer() : new LogMailer();
  return mailer;
}
