import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Observable } from 'rxjs';
import { BinaryService } from '../binary/binary.service';
import { ConcurrencyService } from '../common/concurrency.service';
import { SupportedPlatform } from '../common/platform.util';
import { StreamProxyOptions } from './stream-proxy.service';
export interface CleanFormat {
    formatId: string;
    label: string;
    ext: string;
    type: 'video' | 'audio';
    resolution?: string;
    filesizeApprox?: number;
    needsMerge: boolean;
    streamToken?: string;
}
export interface MediaInfoResponse {
    platform: SupportedPlatform;
    title: string;
    thumbnail: string;
    duration: number;
    uploader: string;
    formats: CleanFormat[];
}
export interface JobProgress {
    status: 'starting' | 'downloading' | 'merging' | 'ready' | 'error';
    percent: number;
    message?: string;
}
export declare class MediaService implements OnModuleInit, OnModuleDestroy {
    private readonly binaryService;
    private readonly concurrency;
    private readonly logger;
    private readonly tempDir;
    private readonly cookiesDir;
    private readonly jobStreams;
    private readonly streamCache;
    private readonly cacheTtlMs;
    private readonly cleanupTimer;
    private readonly extractTimeoutMs;
    private readonly mergeTimeoutMs;
    constructor(binaryService: BinaryService, concurrency: ConcurrencyService);
    onModuleInit(): void;
    onModuleDestroy(): void;
    initCookiesDirectory(): void;
    createTempCookieFile(platform: SupportedPlatform): string | null;
    removeTempCookieFile(tempCookiePath: string | null): void;
    private purgeExpiredTokens;
    cleanStaleTempFiles(maxAgeMs?: number): void;
    getStreamOptions(token: string): StreamProxyOptions;
    getJobStream(jobId: string): Observable<JobProgress>;
    private emitProgress;
    private sanitizeFilename;
    extractMetadata(url: string): Promise<MediaInfoResponse>;
    private normalizeFormats;
    prepareMergedFile(url: string, formatId: string, type: 'video' | 'audio', jobId?: string, abortSignal?: AbortSignal): Promise<{
        filePath: string;
        filename: string;
        mimeType: string;
    }>;
}
