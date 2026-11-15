import { BinaryService } from '../binary/binary.service';
export interface HealthCheckResponse {
    status: 'ok' | 'degraded';
    uptime: number;
    timestamp: string;
    binaries: {
        ytDlp: boolean;
        ffmpeg: boolean;
    };
}
export declare class HealthController {
    private readonly binaryService;
    constructor(binaryService: BinaryService);
    checkHealth(): HealthCheckResponse;
}
