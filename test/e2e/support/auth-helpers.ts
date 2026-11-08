import request from 'supertest';
import { TestApp } from './test-app';

export const PASSWORD = 'correct horse battery';

export interface Session {
  id: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

/** Registers (optionally promotes to admin directly in the database) and logs in. */
export async function signUp(
  t: TestApp,
  email: string,
  role: 'A' | 'N' = 'N',
): Promise<Session> {
  const http = () => request(t.app.getHttpServer());
  const reg = await http().post('/auth/register').send({ name: email, email, password: PASSWORD });
  const id = reg.body.id as string;
  if (role === 'A') await t.prisma.client.user.update({ where: { id }, data: { role: 'A' } });
  const login = await http().post('/auth/login').send({ email, password: PASSWORD });
  return {
    id,
    email,
    accessToken: login.body.accessToken as string,
    refreshToken: login.body.refreshToken as string,
  };
}

export const bearer = (s: Session): [string, string] => ['Authorization', `Bearer ${s.accessToken}`];
