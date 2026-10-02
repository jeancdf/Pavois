import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const url = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/pavois';
    super({ adapter: new PrismaPg({ connectionString: url }) });
  }

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
