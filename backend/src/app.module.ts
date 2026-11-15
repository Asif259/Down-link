import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { BinaryModule } from './binary/binary.module';
import { ProxyThrottlerGuard } from './common/proxy-throttler.guard';
import { TempCleanupService } from './common/temp-cleanup.service';
import { HealthController } from './health/health.controller';
import { MediaModule } from './media/media.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,
        limit: 30,
      },
      {
        name: 'heavy',
        ttl: 60000,
        limit: 6,
      },
    ]),
    BinaryModule,
    MediaModule,
  ],
  controllers: [HealthController],
  providers: [
    TempCleanupService,
    {
      provide: APP_GUARD,
      useClass: ProxyThrottlerGuard,
    },
  ],
})
export class AppModule {}
