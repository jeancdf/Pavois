import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
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

  afterEach(async () => {
    await app.close();
  });
});
