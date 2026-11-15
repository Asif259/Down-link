import { Request, Response } from 'express';
export interface StreamProxyOptions {
    targetUrl: string;
    headers: Record<string, string>;
    filename: string;
    mimeType: string;
}
export declare class StreamProxyService {
    private readonly logger;
    private readonly maxRedirects;
    private readonly connectTimeoutMs;
    private readonly streamInactivityTimeoutMs;
    pipeFromCdn(options: StreamProxyOptions, req: Request, res: Response): void;
    private isPrivateOrBlockedAddress;
    private fetchWithRedirects;
}
