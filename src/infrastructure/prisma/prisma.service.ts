import { PrismaClient } from '@prisma/client';

/** Framework-free wrapper around the Prisma client; the Nest provider comes with the HTTP layer. */
export class PrismaService {
  readonly client: PrismaClient;

  constructor(databaseUrl: string = process.env.DATABASE_URL ?? '') {
    this.client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  }

  connect(): Promise<void> {
    return this.client.$connect();
  }

  disconnect(): Promise<void> {
    return this.client.$disconnect();
  }
}
