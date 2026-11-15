import { Reflector } from '@nestjs/core';
import { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
import { Request } from 'express';
import { ProxyThrottlerGuard } from './proxy-throttler.guard';

describe('ProxyThrottlerGuard', () => {
  let guard: ProxyThrottlerGuard;

  beforeEach(() => {
    const options: ThrottlerModuleOptions = [{ name: 'default', ttl: 60000, limit: 30 }];
    const storageService = {} as ThrottlerStorage;
    const reflector = new Reflector();

    guard = new ProxyThrottlerGuard(options, storageService, reflector);
  });

  const callGetTracker = (reqPartial: Partial<Request>): Promise<string> => {
    return (
      guard as unknown as { getTracker(req: Request): Promise<string> }
    ).getTracker(reqPartial as Request);
  };

  it('prioritizes cf-connecting-ip when present and trims whitespace', async () => {
    const req: Partial<Request> = {
      headers: {
        'cf-connecting-ip': ' 203.0.113.50 ',
        'x-forwarded-for': '198.51.100.1, 10.0.0.1',
      },
      ip: '127.0.0.1',
    };

    await expect(callGetTracker(req)).resolves.toBe('203.0.113.50');
  });

  it('extracts the first client IP from x-forwarded-for when cf-connecting-ip is absent', async () => {
    const req: Partial<Request> = {
      headers: {
        'x-forwarded-for': ' 198.51.100.25 , 172.16.0.5 ',
      },
      ip: '127.0.0.1',
    };

    await expect(callGetTracker(req)).resolves.toBe('198.51.100.25');
  });

  it('falls back to req.ip when proxy headers are missing or blank', async () => {
    const req: Partial<Request> = {
      headers: {
        'cf-connecting-ip': '   ',
        'x-forwarded-for': '',
      },
      ip: '192.0.2.99',
    };

    await expect(callGetTracker(req)).resolves.toBe('192.0.2.99');
  });

  it('falls back to socket.remoteAddress when req.ip is undefined', async () => {
    const req: Partial<Request> = {
      headers: {},
      ip: undefined,
      socket: { remoteAddress: '10.20.30.40' } as Request['socket'],
    };

    await expect(callGetTracker(req)).resolves.toBe('10.20.30.40');
  });

  it('returns unknown-ip when no IP source is available', async () => {
    const req: Partial<Request> = {
      headers: {},
      ip: undefined,
      socket: {} as Request['socket'],
    };

    await expect(callGetTracker(req)).resolves.toBe('unknown-ip');
  });
});
