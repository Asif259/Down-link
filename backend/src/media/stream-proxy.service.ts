import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import * as http from 'http';
import * as https from 'https';

export interface StreamProxyOptions {
  targetUrl: string;
  headers: Record<string, string>;
  filename: string;
  mimeType: string;
}

@Injectable()
export class StreamProxyService {
  private readonly logger = new Logger(StreamProxyService.name);
  private readonly maxRedirects = 5;
  private readonly connectTimeoutMs = 15000;
  private readonly streamInactivityTimeoutMs = 60000;

  pipeFromCdn(options: StreamProxyOptions, req: Request, res: Response): void {
    this.fetchWithRedirects(options.targetUrl, options, req, res, 0);
  }

  private isPrivateOrBlockedAddress(hostname: string): boolean {
    const lower = hostname.toLowerCase();
    if (
      lower === 'localhost' ||
      lower === '127.0.0.1' ||
      lower === '::1' ||
      lower === '0.0.0.0' ||
      lower === '169.254.169.254' // Cloud instance metadata IP
    ) {
      return true;
    }

    // RFC 1918 private IPv4 ranges (10.x, 172.16-31.x, 192.168.x) & Carrier-grade NAT (100.64.x)
    if (
      /^10\./.test(lower) ||
      /^192\.168\./.test(lower) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(lower) ||
      /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./.test(lower)
    ) {
      return true;
    }

    return false;
  }

  private fetchWithRedirects(
    currentUrl: string,
    options: StreamProxyOptions,
    req: Request,
    res: Response,
    redirectCount: number,
  ): void {
    if (redirectCount > this.maxRedirects) {
      if (!res.headersSent) {
        res.status(502).json({ message: 'Too many upstream CDN redirects.' });
      }
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(currentUrl);
    } catch {
      if (!res.headersSent) {
        res.status(400).json({ message: 'Invalid upstream CDN URL.' });
      }
      return;
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      if (!res.headersSent) {
        res.status(400).json({ message: 'Unsupported upstream protocol.' });
      }
      return;
    }

    // SSRF Check: strictly disallow internal networks on redirects
    // Note: Allow 127.0.0.1 only if in test environment for local mock servers
    const isTest = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
    if (this.isPrivateOrBlockedAddress(parsedUrl.hostname)) {
      const isLocalTest = isTest && (parsedUrl.hostname === '127.0.0.1' || parsedUrl.hostname === 'localhost');
      if (!isLocalTest) {
        this.logger.warn(`SSRF attempt blocked to ${parsedUrl.hostname}`);
        if (!res.headersSent) {
          res.status(403).json({ message: 'Access to private/internal network addresses is forbidden.' });
        }
        return;
      }
    }

    const client = parsedUrl.protocol === 'http:' ? http : https;

    // Forward yt-dlp extracted headers + browser Range header if present
    const requestHeaders: Record<string, string> = {
      ...options.headers,
    };
    if (req.headers && req.headers.range) {
      requestHeaders['Range'] = req.headers.range as string;
    }

    const upstreamReq = client.get(
      parsedUrl,
      {
        headers: requestHeaders,
        timeout: this.connectTimeoutMs,
      },
      (upstreamRes) => {
        const statusCode = upstreamRes.statusCode || 500;

        // Follow CDN 301/302/307/308 redirects transparently
        if (
          statusCode >= 300 &&
          statusCode < 400 &&
          upstreamRes.headers.location
        ) {
          upstreamRes.resume(); // Drain redirect body to free socket
          const nextUrl = new URL(upstreamRes.headers.location, parsedUrl).toString();
          return this.fetchWithRedirects(
            nextUrl,
            options,
            req,
            res,
            redirectCount + 1,
          );
        }

        if (statusCode >= 400) {
          upstreamRes.resume();
          this.logger.warn(`Upstream CDN returned HTTP ${statusCode}`);
          if (!res.headersSent) {
            res.status(502).json({
              message: 'CDN link expired or rejected the request. Please re-extract the link.',
            });
          }
          return;
        }

        // Adjust socket timeout to inactivity timeout during active stream transmission
        if (upstreamRes.socket) {
          upstreamRes.socket.setTimeout(this.streamInactivityTimeoutMs);
        }

        // Preserve partial content status (206) if client requested a byte range
        res.status(statusCode === 206 ? 206 : 200);

        res.setHeader(
          'Content-Type',
          upstreamRes.headers['content-type'] || options.mimeType,
        );
        if (upstreamRes.headers['content-length']) {
          res.setHeader('Content-Length', upstreamRes.headers['content-length']);
        }
        if (upstreamRes.headers['content-range']) {
          res.setHeader('Content-Range', upstreamRes.headers['content-range']);
        }
        if (upstreamRes.headers['accept-ranges']) {
          res.setHeader('Accept-Ranges', upstreamRes.headers['accept-ranges']);
        }

        // Support both ASCII fallback and RFC 5987 UTF-8 filenames
        const asciiName = (options.filename.replace(/[^\x20-\x7E]/g, '_').trim() || 'media.mp4')
          .replace(/_{2,}/g, '_');
        const encodedName = encodeURIComponent(options.filename);
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
        );

        upstreamRes.pipe(res);

        // Abort upstream stream if user closes browser tab or aborts
        const abortUpstream = () => {
          if (!res.writableEnded && !upstreamRes.destroyed) {
            upstreamRes.destroy();
          }
        };
        res.on('close', abortUpstream);

        upstreamRes.on('error', (err) => {
          this.logger.error(`Upstream stream error: ${err.message}`);
          if (!res.headersSent) {
            res.status(502).end();
          } else {
            res.end();
          }
        });
      },
    );

    upstreamReq.on('timeout', () => {
      upstreamReq.destroy(new BadGatewayException('Upstream CDN connection timed out.'));
    });

    upstreamReq.on('error', (err) => {
      this.logger.error(`Upstream request failed: ${err.message}`);
      if (!res.headersSent) {
        res.status(502).json({ message: 'Failed to connect to media CDN.' });
      }
    });
  }
}
