import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel, NotificationMessage } from './notification-channel';

@Injectable()
export class DiscordNotificationChannel implements NotificationChannel {
  readonly name = 'Discord';
  private readonly logger = new Logger(DiscordNotificationChannel.name);
  private lastWindowStart = Date.now();
  private countInWindow = 0;
  private overflowCount = 0;

  isEnabled(): boolean {
    const url = process.env.DISCORD_WEBHOOK_URL;
    return typeof url === 'string' && url.trim().length > 0;
  }

  /**
   * Asynchronous fire-and-forget sending to Discord webhook with timeout & overflow rate-limiting.
   * Only CRITICAL alerts and their recoveries should call this method.
   */
  async send(message: NotificationMessage): Promise<boolean> {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL?.trim();
    if (!webhookUrl) return false;

    const maxPerMin = Number(process.env.DISCORD_MAX_ALERTS_PER_MIN) || 5;
    const now = Date.now();

    if (now - this.lastWindowStart > 60000) {
      if (this.overflowCount > 0) {
        const summaryMessage = `⚠️ [DISCORD RATE LIMIT] ${this.overflowCount} alertes critiques additionnelles sont survenues pendant la dernière minute.`;
        this.overflowCount = 0;
        void this.postToDiscord(webhookUrl, {
          title: 'Résumé Débordement Alertes',
          description: summaryMessage,
          severity: 'WARNING',
          timestamp: new Date(),
        });
      }
      this.lastWindowStart = now;
      this.countInWindow = 0;
    }

    if (this.countInWindow >= maxPerMin) {
      this.overflowCount++;
      this.logger.warn(
        `Plafond Discord atteint (${maxPerMin}/min). Message mis au compteur de débordement (${this.overflowCount}).`,
      );
      return false;
    }

    this.countInWindow++;

    // Fire and forget with explicit .catch to avoid unhandled rejections
    this.postToDiscord(webhookUrl, message).catch((err) => {
      this.logger.error(
        `Échec d'envoi Webhook Discord : ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    return true;
  }

  private async postToDiscord(
    webhookUrl: string,
    message: NotificationMessage,
  ): Promise<void> {
    const color =
      message.severity === 'CRITICAL'
        ? 0xff0000
        : message.severity === 'WARNING'
          ? 0xffa500
          : 0x00ff00;

    const payload = {
      username: 'PAVOIS Security',
      embeds: [
        {
          title: message.title,
          description: message.description,
          color,
          timestamp: message.timestamp.toISOString(),
          footer: { text: 'Système Anti-Drone PAVOIS' },
        },
      ],
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        this.logger.warn(
          `Discord Webhook a répondu avec le statut HTTP ${response.status}`,
        );
      }
    } catch (err) {
      clearTimeout(timeoutId);
      this.logger.error(
        `Erreur HTTP Discord : ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
