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

  pipeFromCdn(options: StreamProxyOptions, req: Request, res: Response): void {
    this.fetchWithRedirects(options.targetUrl, options, req, res, 0);
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
        timeout: 20000,
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

        // Support both ASCII fallback and UTF-8 filenames (for emojis/non-Latin titles)
        const asciiName = options.filename.replace(/[^\x20-\x7E]/g, '_');
        const encodedName = encodeURIComponent(options.filename);
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
        );

        upstreamRes.pipe(res);

        // Immediately abort upstream download if user closes browser tab or cancels
        const abortUpstream = () => {
          if (!upstreamRes.destroyed) {
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
      upstreamReq.destroy(new BadGatewayException('Upstream CDN timed out.'));
    });

    upstreamReq.on('error', (err) => {
      this.logger.error(`Upstream request failed: ${err.message}`);
      if (!res.headersSent) {
        res.status(502).json({ message: 'Failed to connect to media CDN.' });
      }
    });
  }
}
