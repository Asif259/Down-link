import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
export declare class TempCleanupService implements OnModuleInit, OnModuleDestroy {
    private readonly logger;
    private readonly tempDir;
    private sweepTimer?;
    private readonly maxMediaAgeMs;
    private readonly maxCookieAgeMs;
    private readonly sweepIntervalMs;
    onModuleInit(): void;
    onModuleDestroy(): void;
    sweepStaleFiles(isStartup?: boolean): number;
}
