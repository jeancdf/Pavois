/**
 * Fonctions utilitaires de sécurité et de formatage pour les notifications Discord PAVOIS.
 */

/**
 * Masque l'URL du Webhook Discord pour empêcher l'exposition de secrets dans les logs.
 * Exemple: "https://discord.com/api/webhooks/12345/abcde" -> "https://discord.com/api/webhooks/***..."
 */
export function maskWebhookUrl(url?: string | null): string {
  if (!url) return '[NON CONFIGURÉ]';
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length >= 3) {
      return `${parsed.protocol}//${parsed.host}/${parts[0]}/${parts[1]}/***`;
    }
    return `${parsed.protocol}//${parsed.host}/.../***`;
  } catch {
    return '[URL INVALIDE MASQUÉE]';
  }
}

/**
 * Valide si une URL correspond à la structure officielle des Webhooks Discord.
 */
export function isValidWebhookUrl(url?: string | null): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  return (
    trimmed.startsWith('https://discord.com/api/webhooks/') ||
    trimmed.startsWith('https://discordapp.com/api/webhooks/')
  );
}

/**
 * Échappe les caractères Markdown spéciaux de Discord dans les données saisies/dynamiques
 * afin de prévenir l'injection de mise en forme ou de fausses notifications.
 */
export function escapeDiscordMarkdown(text?: string | null): string {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/~/g, '\\~')
    .replace(/>/g, '\\>')
    .replace(/@/g, 'ⓐ'); // Remplace @ par un glyphe inoffensif
}

/**
 * Formate une durée en millisecondes sous la forme "X min Y s" ou "Y s".
 */
export function formatDuration(durationMs: number): string {
  const seconds = Math.floor(Math.max(0, durationMs) / 1000);
  const mins = Math.floor(seconds / 60);
  const remainingSecs = seconds % 60;
  if (mins > 0) {
    return `${mins} min ${remainingSecs} s`;
  }
  return `${remainingSecs} s`;
}
