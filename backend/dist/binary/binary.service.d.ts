import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
export declare class BinaryService implements OnModuleInit, OnModuleDestroy {
    private readonly logger;
    private readonly binDir;
    private readonly minBinarySizeBytes;
    private readonly downloadTimeoutMs;
    private updateTimer?;
    get ytDlpBinaryName(): string;
    get ytDlpPath(): string;
    get ffmpegBinaryPath(): string;
    onModuleInit(): Promise<void>;
    onModuleDestroy(): void;
    updateYtDlpBinary(): Promise<string>;
    downloadFile(url: string, dest: string): Promise<void>;
}
