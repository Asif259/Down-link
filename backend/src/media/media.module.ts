import { Module } from '@nestjs/common';
import { BinaryModule } from '../binary/binary.module';
import { ConcurrencyService } from '../common/concurrency.service';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { StreamProxyService } from './stream-proxy.service';

@Module({
  imports: [BinaryModule],
  controllers: [MediaController],
  providers: [MediaService, StreamProxyService, ConcurrencyService],
})
export class MediaModule {}
