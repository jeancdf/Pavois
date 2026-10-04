import { AlertsService } from './alerts.service';
import { EventsGateway } from './realtime/events.gateway';
import { DiscordNotificationChannel } from './discord-notification.channel';
import { CameraHealthService } from './camera-health.service';
import { JsonlAlertStore } from './stores/jsonl-alert.store';
import { AlertCategory, AlertStatus, AlertType, CameraState } from './alert-types';
import * as fs from 'fs';
import * as path from 'path';

describe('AlertsService with JsonlAlertStore', () => {
  let store: JsonlAlertStore;
  let gateway: { broadcast: jest.Mock };
  let discordChannel: { send: jest.Mock };
  let cameraHealth: CameraHealthService;
  let service: AlertsService;
  const testDataDir = path.resolve('./test-data-alerts');

  beforeEach(async () => {
    process.env.ALERTS_DATA_DIR = testDataDir;
    try {
      if (fs.existsSync(testDataDir)) {
        fs.rmSync(testDataDir, { recursive: true, force: true });
      }
    } catch {
      // Ignorer
    }

    store = new JsonlAlertStore();
    await store.onModuleInit();

    gateway = { broadcast: jest.fn() };
    discordChannel = { send: jest.fn().mockResolvedValue(true) };
    cameraHealth = new CameraHealthService();
    cameraHealth.onModuleInit();

    service = new AlertsService(
      store,
      store,
      gateway as unknown as EventsGateway,
      discordChannel as unknown as DiscordNotificationChannel,
      cameraHealth,
    );
  });

  afterEach(async () => {
    cameraHealth.onModuleDestroy();
    try {
      if (fs.existsSync(testDataDir)) {
        fs.rmSync(testDataDir, { recursive: true, force: true });
      }
    } catch {
      // Ignorer
    }
  });

  it('initializes cameras in EN_ATTENTE state without false HORS_SERVICE alert', () => {
    const statuses = cameraHealth.getHealthStatuses();
    expect(statuses.length).toBe(3);
    for (const status of statuses) {
      expect(status.state).toBe(CameraState.EN_ATTENTE);
    }
  });

  it('fires an OBJECT_DETECTED alert the first time a trackId is seen', async () => {
    await service.processTrackAlert({ trackId: 'obj1', cameraIds: ['jean'], confidence: 0.2 });
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
    await service.processTrackAlert({ trackId: 'obj2', classification: 'drone', confidence: 0.8 });
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

  it('continues operating and broadcasting alerts when disk storage throws error', async () => {
    jest.spyOn(store, 'create').mockRejectedValueOnce(new Error('Disque plein ou indisponible'));

    await service.processTrackAlert({ trackId: 'obj3', classification: 'drone', confidence: 0.9 });

    expect(gateway.broadcast).toHaveBeenCalledWith(
      'alert',
      expect.objectContaining({
        type: AlertType.CRITICAL,
        category: AlertCategory.DRONE_CONFIRMED,
        trackId: 'obj3',
      }),
    );
  });

  it('skips corrupted JSONL lines on startup without throwing', async () => {
    const corruptDir = path.resolve('./test-data-corrupted');
    try {
      if (fs.existsSync(corruptDir)) {
        fs.rmSync(corruptDir, { recursive: true, force: true });
      }
    } catch {
      // Ignorer
    }
    fs.mkdirSync(corruptDir, { recursive: true });
    const alertsFile = path.join(corruptDir, 'alerts.jsonl');
    const validAlert = {
      id: 'alt-valid',
      type: 'INFO',
      category: 'OBJECT_DETECTED',
      status: 'NEW',
      message: 'Test Valid',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(alertsFile, 'CORRUPTED_JSON_LINE\n' + JSON.stringify(validAlert) + '\n');

    process.env.ALERTS_DATA_DIR = corruptDir;
    const newStore = new JsonlAlertStore();
    await newStore.onModuleInit();

    const retrieved = await newStore.findUnique('alt-valid');
    expect(retrieved).toBeDefined();
    expect(retrieved?.message).toBe('Test Valid');

    try {
      if (fs.existsSync(corruptDir)) {
        fs.rmSync(corruptDir, { recursive: true, force: true });
      }
    } catch {
      // Ignorer
    }
  });

  it('performs atomic purge of older alerts', async () => {
    const oldAlert = await store.create({
      type: AlertType.INFO,
      category: AlertCategory.OBJECT_DETECTED,
      message: 'Ancienne alerte',
    });
    await store.flush();

    // Backdate the alert createdAt to 35 days ago in memory
    const oldDate = new Date(Date.now() - 35 * 24 * 3600 * 1000).toISOString();
    const inMemory = await store.findUnique(oldAlert.id);
    if (inMemory) {
      inMemory.createdAt = oldDate;
    }

    const purged = await store.purgeOlderThan(30);
    expect(purged).toBe(1);

    const check = await store.findUnique(oldAlert.id);
    expect(check).toBeNull();
  });
});
