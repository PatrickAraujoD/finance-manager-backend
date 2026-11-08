import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../src/presentation/http/decorators/public.decorator';
import { startApp, TestApp } from './support/test-app';

interface RouteInfo {
  route: string;
  isPublic: boolean;
}

function listRoutes(t: TestApp): RouteInfo[] {
  const discovery = new DiscoveryService(t.app.get(ModulesContainer));
  const scanner = new MetadataScanner();
  const reflector = t.app.get(Reflector);
  const routes: RouteInfo[] = [];
  for (const wrapper of discovery.getControllers()) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;
    const prefix = (Reflect.getMetadata(PATH_METADATA, metatype) as string) ?? '';
    for (const name of scanner.getAllMethodNames(Object.getPrototypeOf(instance))) {
      const handler = instance[name] as (...args: unknown[]) => unknown;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (method === undefined) continue;
      const path = (Reflect.getMetadata(PATH_METADATA, handler) as string) ?? '';
      const isPublic = reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
        handler,
        metatype,
      ]);
      routes.push({
        route: `${RequestMethod[method]} /${[prefix, path].filter((p) => p && p !== '/').join('/')}`,
        isPublic: isPublic === true,
      });
    }
  }
  return routes;
}

describe('public route inventory', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('exposes exactly the five known public routes; new routes are born private', () => {
    const publicRoutes = listRoutes(t)
      .filter((r) => r.isPublic)
      .map((r) => r.route)
      .sort();
    expect(publicRoutes).toEqual(
      [
        'GET /health',
        'POST /auth/login',
        'POST /auth/logout',
        'POST /auth/refresh',
        'POST /auth/register',
      ].sort(),
    );
  });

  it('finds the private routes too (guards the inventory itself)', () => {
    const all = listRoutes(t).map((r) => r.route);
    expect(all).toContain('GET /auth/me');
  });
});
