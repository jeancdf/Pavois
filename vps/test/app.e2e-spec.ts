import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { applyBodyParsers } from './../src/http-body';
import { UdpService } from './../src/udp.service';

const TEST_AUTH_TOKEN = 'e2e-test-token';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    process.env.WS_AUTH_TOKEN = TEST_AUTH_TOKEN;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    applyBodyParsers(app);
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/auth/verify (GET) rejects a missing token', () => {
    return request(app.getHttpServer()).get('/auth/verify').expect(401);
  });

  it('/auth/verify (GET) rejects an invented token', () => {
    return request(app.getHttpServer())
      .get('/auth/verify')
      .set('Authorization', 'Bearer nimporte-quoi')
      .expect(401);
  });

  it('/auth/verify (GET) accepts the configured token', () => {
    const token = TEST_AUTH_TOKEN;
    return request(app.getHttpServer())
      .get('/auth/verify')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect({ ok: true });
  });

  it('/attitude (POST) accepts a live IMU sample', () => {
    const token = TEST_AUTH_TOKEN;
    return request(app.getHttpServer())
      .post('/attitude')
      .set('Authorization', `Bearer ${token}`)
      .send({
        cameraId: 'jean',
        headingDeg: 171.4,
        elevationDeg: -2.5,
        rollDeg: 1.2,
      })
      .expect(201)
      .expect({ ok: true });
  });

  it('/attitude (POST) accepts calibration and a frozen heading', () => {
    const token = process.env.WS_AUTH_TOKEN || 'dev-pavois-token';
    return request(app.getHttpServer())
      .post('/attitude')
      .set('Authorization', `Bearer ${token}`)
      .send({
        cameraId: 'jean',
        headingDeg: 171.4,
        elevationDeg: -2.5,
        rollDeg: 1.2,
        calib: '---3',
        valid: false,
      })
      .expect(201)
      .expect({ ok: true });
  });

  it('/attitude (POST) rejects a malformed calibration token', () => {
    const token = process.env.WS_AUTH_TOKEN || 'dev-pavois-token';
    return request(app.getHttpServer())
      .post('/attitude')
      .set('Authorization', `Bearer ${token}`)
      .send({
        cameraId: 'jean',
        headingDeg: 171.4,
        elevationDeg: -2.5,
        rollDeg: 1.2,
        calib: '3403',
      })
      .expect(400);
  });

  it('/preview (POST) accepts a jpeg thumbnail', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 1, 2, 3, 4, 5, 6, 7, 8]);
    return request(app.getHttpServer())
      .post('/preview?cameraId=jean')
      .set('Content-Type', 'image/jpeg')
      .send(jpeg)
      .expect(201)
      .expect({ ok: true });
  });

  it('/api/preview (POST) accepts the nginx path', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 1, 2, 3, 4, 5, 6, 7, 8]);
    return request(app.getHttpServer())
      .post('/api/preview?cameraId=jean')
      .set('Content-Type', 'image/jpeg')
      .send(jpeg)
      .expect(201)
      .expect({ ok: true });
  });

  it('/preview (POST) rejects a non-jpeg body', () => {
    return request(app.getHttpServer())
      .post('/preview?cameraId=jean')
      .set('Content-Type', 'image/jpeg')
      .send(Buffer.from('not-a-jpeg-body!!'))
      .expect(400);
  });

  it('/fusion (GET) rejects a missing token', () => {
    return request(app.getHttpServer()).get('/fusion').expect(401);
  });

  it('/fusion (GET) returns an empty diagnostic snapshot', () => {
    const token = process.env.WS_AUTH_TOKEN || 'dev-pavois-token';
    return request(app.getHttpServer())
      .get('/fusion')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.activeCameras).toBe(0);
        expect(res.body.cameraCount).toBe(0);
        expect(Array.isArray(res.body.cameras)).toBe(true);
        expect(res.body.lastFuse).toBeNull();
      });
  });

  it('/fusion (GET) keeps detections from three cameras', async () => {
    const token = process.env.WS_AUTH_TOKEN || 'dev-pavois-token';
    const udp = app.get(UdpService);
    const timestamp = Date.now();
    for (const cameraId of ['jean', 'tanel', 'walid']) {
      udp.ingestRawDetection({
        type: 'raw_detection',
        cameraId,
        frameIndex: 1,
        timestamp,
        x: 10,
        y: 20,
        size: 5,
        confidence: 0.9,
        headingDeg: 164.2,
        elevationDeg: -1.5,
        rollDeg: 0.3,
      });
    }

    const res = await request(app.getHttpServer())
      .get('/fusion')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.activeCameras).toBe(3);
    expect(res.body.cameraCount).toBe(3);
    expect(res.body.cameras).toHaveLength(3);
    for (const camera of res.body.cameras) {
      expect(camera.active).toBe(true);
      expect(camera.hasPose).toBe(true);
      expect(camera.ageMs).toBeGreaterThanOrEqual(0);
      expect(camera.detectionCount).toBe(1);
    }
  });

  afterEach(async () => {
    await app.close();
  });
});
