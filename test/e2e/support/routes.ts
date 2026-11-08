import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../../src/presentation/http/decorators/public.decorator';
import { ROLES_KEY } from '../../../src/presentation/http/decorators/roles.decorator';
import { TestApp } from './test-app';

export interface RouteInfo {
  /** `METHOD /path/:param`, the key used by the inventories. */
  route: string;
  method: string;
  path: string;
  isPublic: boolean;
  roles: string[];
}

/** Every route registered in the running app, read from the controllers' metadata. */
export function listRoutes(t: TestApp): RouteInfo[] {
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
      const sub = (Reflect.getMetadata(PATH_METADATA, handler) as string) ?? '';
      const path = `/${[prefix, sub].filter((p) => p && p !== '/').join('/')}`;
      const targets = [handler, metatype];
      routes.push({
        route: `${RequestMethod[method]} ${path}`,
        method: RequestMethod[method],
        path,
        isPublic: reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, targets) === true,
        roles: reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, targets) ?? [],
      });
    }
  }
  return routes.sort((a, b) => a.route.localeCompare(b.route));
}
