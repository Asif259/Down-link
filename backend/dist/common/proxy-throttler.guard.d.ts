import { ThrottlerGuard } from '@nestjs/throttler';
export declare class ProxyThrottlerGuard extends ThrottlerGuard {
    protected getTracker(req: Record<string, any>): Promise<string>;
}
