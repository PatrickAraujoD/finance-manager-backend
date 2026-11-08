import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** Ties the framework-free PrismaService to the Nest application lifecycle. */
@Injectable()
export class NestPrismaService extends PrismaService implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }
}
