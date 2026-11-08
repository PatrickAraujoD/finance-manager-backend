import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../../src/presentation/http/app';
import { testConfig } from './support/test-app';

describe('GET /health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp(testConfig());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns status ok', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
