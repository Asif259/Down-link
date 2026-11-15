import { MessageEvent } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { DownloadQueryDto, ExtractMediaDto } from './dto/media.dto';
import { MediaService } from './media.service';
import { StreamProxyService } from './stream-proxy.service';
import { BinaryService } from '../binary/binary.service';
import { ConcurrencyService } from '../common/concurrency.service';
export declare class MediaController {
    private readonly mediaService;
    private readonly streamProxyService;
    private readonly binaryService;
    private readonly concurrencyService;
    constructor(mediaService: MediaService, streamProxyService: StreamProxyService, binaryService: BinaryService, concurrencyService: ConcurrencyService);
    getHealth(): {
        status: string;
        timestamp: string;
        uptimeSeconds: number;
        concurrency: import("../common/concurrency.service").ConcurrencyStatus;
        ytDlpPath: string;
    };
    extract(dto: ExtractMediaDto): Promise<import("./media.service").MediaInfoResponse>;
    streamDirect(token: string, req: Request, res: Response): void;
    streamProgress(jobId: string, res?: Response): Observable<MessageEvent>;
    download(query: DownloadQueryDto, req: Request, res: Response): Promise<void>;
}
