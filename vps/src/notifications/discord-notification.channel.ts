import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { NotificationChannel, NotificationMessage } from './notification-channel';
import {
  escapeDiscordMarkdown,
  formatDuration,
  isValidWebhookUrl,
  maskWebhookUrl,
} from './discord-formatter';

const QUEUE_MAX_SIZE = 100;
const HTTP_TIMEOUT_MS = 5000;
const MAX_NETWORK_RETRIES = 3;

@Injectable()
export class DiscordNotificationChannel implements NotificationChannel, OnModuleInit {
  readonly name = 'Discord';
  private readonly logger = new Logger(DiscordNotificationChannel.name);

  private disabledPermanently = false;
  private hasLoggedDisabilityError = false;

  private lastWindowStart = Date.now();
  private countInWindow = 0;
  private overflowCount = 0;

  private queue: NotificationMessage[] = [];
  private isProcessingQueue = false;

  onModuleInit() {
    this.validateConfiguration();
  }

  /**
   * Valide la configuration au démarrage du serveur (log sans exposer le secret).
   */
  validateConfiguration(): boolean {
    const rawUrl = process.env.DISCORD_WEBHOOK_URL?.trim();
    const isExplicitlyDisabled = process.env.DISCORD_ENABLED === 'false';

    if (isExplicitlyDisabled) {
      this.disabledPermanently = true;
      this.logger.log('Discord : désactivé (DISCORD_ENABLED=false)');
      return false;
    }

    if (!rawUrl) {
      this.disabledPermanently = true;
      this.logger.log('Discord : désactivé (DISCORD_WEBHOOK_URL non configurée)');
      return false;
    }

    if (!isValidWebhookUrl(rawUrl)) {
      this.disabledPermanently = true;
      this.logger.warn(
        `Discord : désactivé (URL de webhook invalide : ${maskWebhookUrl(rawUrl)})`,
      );
      return false;
    }

    this.disabledPermanently = false;
    this.logger.log(`Discord : activé (salon configuré : ${maskWebhookUrl(rawUrl)})`);
    return true;
  }

  isEnabled(): boolean {
    if (this.disabledPermanently) return false;
    const rawUrl = process.env.DISCORD_WEBHOOK_URL?.trim();
    return isValidWebhookUrl(rawUrl) && process.env.DISCORD_ENABLED !== 'false';
  }

  /**
   * Envoie de manière asynchrone non-bloquante via file d'attente en mémoire.
   */
  async send(message: NotificationMessage): Promise<boolean> {
    if (!this.isEnabled()) return false;

    // Filtrage par catégorie si DISCORD_CATEGORIES est configuré
    if (!this.isCategoryAllowed(message.category)) {
      return false;
    }

    if (this.queue.length >= QUEUE_MAX_SIZE) {
      this.overflowCount++;
      this.logger.warn(
        `File d'attente Discord pleine (${QUEUE_MAX_SIZE}). Message ignoré (${message.title}).`,
      );
      return false;
    }

    this.queue.push(message);
    void this.processQueue().catch((err) => {
      this.logger.error(`Erreur file d'attente Discord : ${err}`);
    });

    return true;
  }

  private isCategoryAllowed(category?: string): boolean {
    const configuredCategories = process.env.DISCORD_CATEGORIES?.trim();
    if (!configuredCategories) return true; // Défaut : toutes les catégories transmises
    const allowed = configuredCategories.split(',').map((c) => c.trim());
    return !category || allowed.includes(category);
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.disabledPermanently) return;
    this.isProcessingQueue = true;

    try {
      while (this.queue.length > 0 && !this.disabledPermanently) {
        const now = Date.now();
        const maxPerMin = Number(process.env.DISCORD_MAX_ALERTS_PER_MIN) || 5;

        // Réinitialisation de la fenêtre de rate-limiting (60 secondes)
        if (now - this.lastWindowStart > 60000) {
          if (this.overflowCount > 0) {
            const count = this.overflowCount;
            this.overflowCount = 0;
            const operatorUrl = process.env.OPERATOR_URL?.trim();
            const description = `⚠️ **+${count} alertes critiques supplémentaires** sont survenues pendant la dernière minute.${
              operatorUrl ? `\n\n👉 [Consulter l'écran opérateur](${operatorUrl})` : ''
            }`;

            await this.postWithRetry({
              title: '⚠️ Résumé Débordement Alertes',
              description,
              severity: 'WARNING',
              timestamp: new Date(),
            });
          }
          this.lastWindowStart = now;
          this.countInWindow = 0;
        }

        if (this.countInWindow >= maxPerMin) {
          this.overflowCount++;
          const dropped = this.queue.shift();
          this.logger.warn(
            `Plafond Discord atteint (${maxPerMin}/min). Message mis en débordement (${dropped?.title || 'Alerte'}).`,
          );
          continue;
        }

        const msg = this.queue.shift();
        if (!msg) break;

        this.countInWindow++;
        await this.postWithRetry(msg);
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  private async postWithRetry(message: NotificationMessage): Promise<void> {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL?.trim();
    if (!webhookUrl || this.disabledPermanently) return;

    const payload = this.buildDiscordPayload(message);

    for (let attempt = 1; attempt <= MAX_NETWORK_RETRIES; attempt++) {
      if (this.disabledPermanently) return;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          return; // Envoi réussi avec succès
        }

        // Gestion 401, 403, 404 : webhook invalide ou supprimé -> Désactivation définitive
        if ([401, 403, 404].includes(response.status)) {
          this.disabledPermanently = true;
          if (!this.hasLoggedDisabilityError) {
            this.hasLoggedDisabilityError = true;
            this.logger.error(
              `Webhook Discord inaccessible (HTTP ${response.status}). Canal désactivé jusqu'au redémarrage.`,
            );
          }
          return;
        }

        // Gestion 429 Too Many Requests de Discord
        if (response.status === 429) {
          let retryAfterMs = 2000;
          try {
            const body = (await response.json()) as { retry_after?: number };
            if (typeof body.retry_after === 'number') {
              retryAfterMs = body.retry_after > 100 ? body.retry_after : body.retry_after * 1000;
            }
          } catch {
            const header = response.headers.get('Retry-After');
            if (header) retryAfterMs = Number(header) * 1000 || 2000;
          }

          this.logger.warn(`Rate limit Discord (HTTP 429). Pause de ${retryAfterMs} ms...`);
          await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
          continue;
        }

        // Gestion 5xx (Erreur serveur Discord) -> Backoff exponentiel
        if (response.status >= 500) {
          this.logger.warn(`Erreur serveur Discord (HTTP ${response.status}), tentative ${attempt}/${MAX_NETWORK_RETRIES}`);
          if (attempt < MAX_NETWORK_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
            continue;
          }
        }

        // Autres erreurs 4xx non gérées
        const errorText = await response.text().catch(() => '');
        this.logger.error(
          `Échec envoi Webhook Discord (HTTP ${response.status}) : ${errorText.slice(0, 200)}`,
        );
        return;
      } catch (err) {
        clearTimeout(timeoutId);
        const isAbort = (err as Error)?.name === 'AbortError';
        const errMsg = isAbort ? `Timeout de ${HTTP_TIMEOUT_MS} ms dépassé` : (err as Error)?.message || String(err);

        this.logger.warn(`Erreur réseau Discord (tentative ${attempt}/${MAX_NETWORK_RETRIES}) : ${errMsg}`);

        if (attempt < MAX_NETWORK_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        } else {
          this.logger.error(`Abandon envoi Webhook Discord après ${MAX_NETWORK_RETRIES} tentatives : ${errMsg}`);
        }
      }
    }
  }

  private buildDiscordPayload(message: NotificationMessage): Record<string, unknown> {
    const isSimulation =
      message.isSimulation ?? process.env.SIMULATION_MODE === 'true';

    const rawTitle = message.title;
    const title = isSimulation ? `[SIMULATION] ${rawTitle}` : rawTitle;

    // Couleurs exactes
    let color = 0xe5484d; // Rouge par défaut
    if (message.category === 'SYSTEM_BLIND') {
      color = 0xb42318; // Rouge foncé
    } else if (
      message.category === 'CAMERA_RECOVERED' ||
      message.severity === 'INFO'
    ) {
      color = 0x30a46c; // Vert
    } else if (message.severity === 'WARNING') {
      color = 0xf59e0b; // Orange
    }

    const unixSeconds = Math.floor(message.timestamp.getTime() / 1000);
    const relativeTime = `<t:${unixSeconds}:R>`;
    const description = `${escapeDiscordMarkdown(message.description)}\n\n⏱️ ${relativeTime}`;

    const fields: { name: string; value: string; inline?: boolean }[] = [];

    if (message.cameraIds && message.cameraIds.length > 0) {
      fields.push({
        name: '📷 Caméra(s)',
        value: message.cameraIds.map((c) => `\`${escapeDiscordMarkdown(c)}\``).join(', '),
        inline: true,
      });
    }

    if (message.cause) {
      fields.push({
        name: '📌 Cause / Raison',
        value: escapeDiscordMarkdown(message.cause),
        inline: true,
      });
    }

    if (typeof message.confidence === 'number') {
      fields.push({
        name: '🎯 Confiance',
        value: `**${(message.confidence * 100).toFixed(0)}%**`,
        inline: true,
      });
    }

    const includePos = process.env.DISCORD_INCLUDE_POSITION !== 'false';
    if (includePos && typeof message.lat === 'number' && typeof message.lng === 'number') {
      fields.push({
        name: '📍 Position GPS',
        value: `\`${message.lat.toFixed(4)}, ${message.lng.toFixed(4)}\``,
        inline: true,
      });
    }

    if (message.reliability) {
      const badge =
        message.reliability === 'GREEN'
          ? '🟢 Nominal (3/3)'
          : message.reliability === 'ORANGE'
            ? '🟠 Dégradé (2/3)'
            : '🔴 SYSTÈME AVEUGLE (<=1/3)';
      fields.push({
        name: '🛡️ Fiabilité Globale',
        value: badge,
        inline: true,
      });
    }

    if (message.incidentDurationMs) {
      fields.push({
        name: '⏱️ Durée de l\'incident',
        value: `\`${formatDuration(message.incidentDurationMs)}\``,
        inline: true,
      });
    }

    if (message.alertId) {
      fields.push({
        name: '🆔 ID Alerte',
        value: `\`${escapeDiscordMarkdown(message.alertId)}\``,
        inline: true,
      });
    }

    const operatorUrl = process.env.OPERATOR_URL?.trim();
    if (operatorUrl) {
      fields.push({
        name: '🔗 Action',
        value: `[Consulter l'écran opérateur](${operatorUrl})`,
        inline: false,
      });
    }

    const envLabel = process.env.DISCORD_ENV_LABEL || 'DEV';
    const footerText = `PAVOIS · Groupe 11 · ${envLabel}`;

    const embed = {
      title,
      description,
      color,
      fields,
      timestamp: message.timestamp.toISOString(),
      footer: { text: footerText },
    };

    // Gestion sécurisée des mentions
    const roleId = process.env.DISCORD_MENTION_ROLE_ID?.trim();
    const isMajorAlert =
      message.category === 'DRONE_CONFIRMED' ||
      message.category === 'SYSTEM_BLIND';

    let content: string | undefined = undefined;
    const allowed_mentions: { parse: string[]; roles?: string[] } = { parse: [] };

    if (roleId && isMajorAlert) {
      content = `<@&${roleId}> 🚨 **Alerte Majeure PAVOIS**`;
      allowed_mentions.roles = [roleId];
    }

    return {
      username: 'PAVOIS',
      content,
      embeds: [embed],
      allowed_mentions,
    };
  }
}
