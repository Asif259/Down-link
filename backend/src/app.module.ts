import { Module } from '@nestjs/common';
import { BinaryModule } from './binary/binary.module';
import { MediaModule } from './media/media.module';

@Module({
  imports: [BinaryModule, MediaModule],
})
export class AppModule {}
