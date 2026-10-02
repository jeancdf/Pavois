import { AlertsService } from './alerts.service';
import { PrismaService } from './prisma.service';
import { EventsGateway } from './events.gateway';
import { DiscordNotificationChannel } from './discord-notification.channel';
import { CameraHealthService } from './camera-health.service';
import { AlertCategory, AlertStatus, AlertType } from '@prisma/client';

function fakePrisma() {
  return {
    alert: {
      create: jest.fn().mockImplementation((args) =>
        Promise.resolve({
          id: 'alert-1',
          ...args.data,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
      update: jest.fn().mockImplementation((args) =>
        Promise.resolve({
          id: args.where.id,
          ...args.data,
        }),
      ),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
    },
    cameraStateLog: {
      create: jest.fn().mockResolvedValue(undefined),
    },
  };
}

describe('AlertsService', () => {
  let prisma: ReturnType<typeof fakePrisma>;
  let gateway: { broadcast: jest.Mock };
  let discordChannel: { send: jest.Mock };
  let cameraHealth: CameraHealthService;
  let service: AlertsService;

  beforeEach(() => {
    prisma = fakePrisma();
    gateway = { broadcast: jest.fn() };
    discordChannel = { send: jest.fn().mockResolvedValue(true) };
    cameraHealth = new CameraHealthService();
    cameraHealth.onModuleInit();

    service = new AlertsService(
      prisma as unknown as PrismaService,
      gateway as unknown as EventsGateway,
      discordChannel as unknown as DiscordNotificationChannel,
      cameraHealth,
    );
  });

  afterEach(() => {
    cameraHealth.onModuleDestroy();
  });

  it('fires an OBJECT_DETECTED alert the first time a trackId is seen', async () => {
    await service.onTrackUpdate({ trackId: 'obj1', cameraIds: ['jean'], confidence: 0.2 });
    expect(gateway.broadcast).toHaveBeenCalledWith(
      'alert',
      expect.objectContaining({
        type: AlertType.INFO,
        category: AlertCategory.OBJECT_DETECTED,
        message: 'Objet détecté (Piste obj1)',
        trackId: 'obj1',
      }),
    );
  });

  it('evolves an existing track to DRONE_CONFIRMED when confidence is high', async () => {
    await service.onTrackUpdate({ trackId: 'obj2', classification: 'drone', confidence: 0.8 });
    expect(gateway.broadcast).toHaveBeenCalledWith(
      'alert',
      expect.objectContaining({
        type: AlertType.CRITICAL,
        category: AlertCategory.DRONE_CONFIRMED,
        trackId: 'obj2',
      }),
    );
    expect(discordChannel.send).toHaveBeenCalled();
  });
});
