import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class ProxyThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const cfIp = req.headers?.['cf-connecting-ip'];
    if (typeof cfIp === 'string' && cfIp.trim()) {
      return cfIp.trim();
    }

    const forwardedFor = req.headers?.['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
      return forwardedFor.split(',')[0].trim();
    }

    return req.ip || req.socket?.remoteAddress || 'unknown-ip';
  }
}
