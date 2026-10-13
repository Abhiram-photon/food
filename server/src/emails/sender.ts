/**
 * Email is deferred for the MVP (see docs/DECISIONS.md). The interface exists so
 * the call sites are already in place: swapping in SMTP/Resend/Postmark later is
 * a one-file change, and no request flow depends on email succeeding.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
  /** Optional template name for future providers. */
  template?: string;
}

export interface EmailSender {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/** Default implementation: logs the email and never throws. */
export class ConsoleEmailSender implements EmailSender {
  readonly name = 'console';
  readonly sent: EmailMessage[] = [];

  constructor(private readonly enabled = true) {}

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    if (this.enabled) {
      console.log(
        `[email:console] to=${message.to} subject="${message.subject}"\n${message.body}`,
      );
    }
  }
}

/** Records messages without logging — used in tests. */
export class MemoryEmailSender implements EmailSender {
  readonly name = 'memory';
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
}

export function createEmailSender(config: { logLevel: string }): EmailSender {
  return new ConsoleEmailSender(config.logLevel !== 'silent');
}
