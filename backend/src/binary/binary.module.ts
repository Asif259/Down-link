import { Module } from '@nestjs/common';
import { BinaryService } from './binary.service';

@Module({
  providers: [BinaryService],
  exports: [BinaryService],
})
export class BinaryModule {}
