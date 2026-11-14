import { IsIn, IsNotEmpty, IsOptional, IsString, IsUrl, Matches } from 'class-validator';

export class ExtractMediaDto {
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @IsNotEmpty()
  url: string;
}

export class DownloadQueryDto {
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  url: string;

  @IsString()
  @Matches(/^[a-zA-Z0-9+_.-]+$/, { message: 'Invalid format identifier' })
  formatId: string;

  @IsIn(['video', 'audio'])
  type: 'video' | 'audio';

  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]+$/)
  jobId?: string;
}
