import { Resend } from "resend";
import { appConfig } from "@/config/app.js";
import { isDeployedEnvironment } from "@/config/environment.js";
import { logger } from "@/config/logger.js";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Per-message sender; falls back to the mailer's default (`appConfig.email.from.default`). */
  from?: string;
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

/**
 * Production adapter over the Resend SDK. Sends real mail using the account API key (EMAIL_KEY). The
 * key is never logged. It THROWS on a delivery error so callers decide whether the failure is fatal —
 * a welcome email swallows it (best-effort), a future password-reset would surface it.
 */
class ResendMailer implements Mailer {
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly defaultFrom: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(message: MailMessage): Promise<void> {
    const { error } = await this.client.emails.send({
      from: message.from ?? this.defaultFrom,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });
    if (error) {
      throw new Error(error.message);
    }
  }
}

let mailer: Mailer | null = null;

/**
 * Selects the mailer once per process:
 *   - EMAIL_KEY set → ResendMailer (real delivery in ANY env, so a flow can be tested locally too).
 *   - else deployed → NoopMailer (drop + warn, never a token in shared logs).
 *   - else (dev)    → LogMailer (writes the message to local logs).
 */
export function getMailer(): Mailer {
  if (mailer) {
    return mailer;
  }
  const apiKey = process.env["EMAIL_KEY"];
  if (apiKey) {
    mailer = new ResendMailer(apiKey, appConfig.email.from.default);
  } else if (isDeployedEnvironment()) {
    mailer = new NoopMailer();
  } else {
    mailer = new LogMailer();
  }
  return mailer;
}
