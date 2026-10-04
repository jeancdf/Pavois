import { DiscordNotificationChannel } from './discord-notification.channel';
import { escapeDiscordMarkdown, maskWebhookUrl } from './discord-formatter';
import { NotificationMessage } from './notification-channel';

describe('DiscordNotificationChannel', () => {
  let channel: DiscordNotificationChannel;
  const originalEnv = process.env;
  const mockWebhookUrl = 'https://discord.com/api/webhooks/123456789/mock-token-xyz';

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    process.env.DISCORD_WEBHOOK_URL = mockWebhookUrl;
    process.env.DISCORD_ENABLED = 'true';
    process.env.DISCORD_MAX_ALERTS_PER_MIN = '5';
    channel = new DiscordNotificationChannel();

    // Mock global fetch
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('Configuration & Initialization', () => {
    it('should be enabled when valid URL is present', () => {
      channel.onModuleInit();
      expect(channel.isEnabled()).toBe(true);
    });

    it('should be disabled when DISCORD_ENABLED is false', () => {
      process.env.DISCORD_ENABLED = 'false';
      channel.onModuleInit();
      expect(channel.isEnabled()).toBe(false);
    });

    it('should be disabled when URL is invalid', () => {
      process.env.DISCORD_WEBHOOK_URL = 'https://invalid-domain.com/webhook';
      channel.onModuleInit();
      expect(channel.isEnabled()).toBe(false);
    });

    it('should mask webhook URL in string representation', () => {
      const masked = maskWebhookUrl(mockWebhookUrl);
      expect(masked).not.toContain('mock-token-xyz');
      expect(masked).toBe('https://discord.com/api/webhooks/***');
    });

    it('should escape discord markdown and @ mentions', () => {
      const escaped = escapeDiscordMarkdown('@everyone *bold* `code` _italic_');
      expect(escaped).not.toContain('@everyone');
      expect(escaped).toContain('ⓐeveryone');
      expect(escaped).toContain('\\*bold\\*');
    });
  });

  describe('Sending Notifications', () => {
    it('should format payload correctly and perform fetch request', async () => {
      channel.onModuleInit();

      const message: NotificationMessage = {
        title: 'CAMÉRA MASQUÉE',
        description: 'La caméra CAM-01 est masquée.',
        severity: 'CRITICAL',
        category: 'CAMERA_MASKED',
        timestamp: new Date('2026-10-03T20:00:00Z'),
        cameraIds: ['CAM-01'],
        cause: 'Obstruction physique',
        lat: 48.8566,
        lng: 2.3522,
        reliability: 'ORANGE',
        alertId: 'ALT-100',
        isSimulation: false,
      };

      const result = await channel.send(message);
      expect(result).toBe(true);

      // Wait for queue loop
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      expect(callArgs[0]).toBe(mockWebhookUrl);

      const body = JSON.parse(callArgs[1].body);
      expect(body.username).toBe('PAVOIS');
      expect(body.embeds[0].title).toBe('CAMÉRA MASQUÉE');
      expect(body.embeds[0].color).toBe(0xe5484d); // CRITICAL Hex red
      expect(body.allowed_mentions).toEqual({ parse: [] });
    });

    it('should handle role mention for major alerts when DISCORD_MENTION_ROLE_ID is set', async () => {
      process.env.DISCORD_MENTION_ROLE_ID = '999888777';
      channel.onModuleInit();

      const message: NotificationMessage = {
        title: 'DRONE CONFIRMÉ',
        description: 'Drone malveillant détecté.',
        severity: 'CRITICAL',
        category: 'DRONE_CONFIRMED',
        timestamp: new Date(),
      };

      await channel.send(message);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(body.content).toContain('<@&999888777>');
      expect(body.allowed_mentions.roles).toEqual(['999888777']);
    });

    it('should permanently disable channel on HTTP 404 or 401 or 403', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Not Found',
      });

      channel.onModuleInit();
      const message: NotificationMessage = {
        title: 'TEST 404',
        description: 'Test error',
        severity: 'CRITICAL',
        timestamp: new Date(),
      };

      await channel.send(message);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(channel.isEnabled()).toBe(false);

      // Subsequent sends should return false immediately
      const result2 = await channel.send(message);
      expect(result2).toBe(false);
    });

    it('should handle HTTP 429 rate limit with retry_after delay', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: async () => ({ retry_after: 0.05 }), // 50 ms
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        });

      channel.onModuleInit();
      const message: NotificationMessage = {
        title: 'TEST 429',
        description: 'Test rate limit',
        severity: 'CRITICAL',
        timestamp: new Date(),
      };

      await channel.send(message);
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on HTTP 500 server error', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => 'Internal Server Error',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        });

      channel.onModuleInit();
      const message: NotificationMessage = {
        title: 'TEST 500',
        description: 'Test server error retry',
        severity: 'CRITICAL',
        timestamp: new Date(),
      };

      await channel.send(message);
      await new Promise((resolve) => setTimeout(resolve, 2500)); // exponential delay ~2s

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });
});
