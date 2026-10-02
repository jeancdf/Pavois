import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Connecté à PostgreSQL / Prisma');
    } catch (err) {
      this.logger.warn(`Prisma $connect ignoration (mode sans DB) : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
