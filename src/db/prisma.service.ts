import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../generated/prisma/client';
import { dbPath } from '../common/paths';

/**
 * Deliberately does NOT $connect() in onModuleInit: Nest runs that hook for
 * every provider in the graph before any command's run() executes, but
 * `jobhunt init` is what creates $JOBHUNT_HOME in the first place — connecting
 * eagerly here would try to open the db file before that directory exists.
 * Prisma connects lazily on first query instead, which by then is safe.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaBetterSqlite3({ url: `file:${dbPath()}` }) });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
