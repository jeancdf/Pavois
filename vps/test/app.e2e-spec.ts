import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { applyBodyParsers } from './../src/http-body';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
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
    const token = process.env.WS_AUTH_TOKEN || 'dev-pavois-token';
    return request(app.getHttpServer())
      .get('/auth/verify')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect({ ok: true });
  });

  it('/attitude (POST) accepts a live IMU sample', () => {
    const token = process.env.WS_AUTH_TOKEN || 'dev-pavois-token';
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

  afterEach(async () => {
    await app.close();
  });
});
