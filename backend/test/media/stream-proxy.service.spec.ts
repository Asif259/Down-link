import { StreamProxyService } from '../../src/media/stream-proxy.service';
import * as http from 'http';
import { AddressInfo } from 'net';
import { EventEmitter } from 'events';

describe('StreamProxyService', () => {
  let service: StreamProxyService;
  let server: http.Server;
  let serverUrl: string;
  let lastReceivedHeaders: http.IncomingHttpHeaders;

  beforeAll((done) => {
    server = http.createServer((req, res) => {
      lastReceivedHeaders = req.headers;

      if (req.url === '/redirect') {
        res.writeHead(302, { Location: `${serverUrl}/stream-target` });
        res.end();
        return;
      }

      if (req.url === '/redirect-ssrf') {
        res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
        res.end();
        return;
      }

      if (req.url === '/error-403') {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      if (req.url === '/stream-target') {
        res.writeHead(200, {
          'content-type': 'video/mp4',
          'content-length': '11',
          'accept-ranges': 'bytes',
        });
        res.end('video bytes');
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      serverUrl = `http://127.0.0.1:${addr.port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    service = new StreamProxyService();
  });

  const createMockReqRes = (reqHeaders: Record<string, string> = {}) => {
    const req = {
      headers: reqHeaders,
    } as any;

    const resHeaders: Record<string, any> = {};
    const res = new EventEmitter() as any;
    res.headersSent = false;
    res.statusCode = 200;
    res.writableEnded = false;
    res.setHeader = jest.fn((k: string, v: any) => {
      resHeaders[k.toLowerCase()] = v;
    });
    res.status = jest.fn((code: number) => {
      res.statusCode = code;
      return res;
    });
    res.json = jest.fn((data: any) => {
      res.headersSent = true;
      res.body = data;
      res.writableEnded = true;
      res.emit('finish');
      return res;
    });
    res.end = jest.fn((data: any) => {
      res.headersSent = true;
      if (data) res.body = data;
      res.writableEnded = true;
      res.emit('finish');
      return res;
    });
    res.write = jest.fn((chunk: any) => {
      res.body = (res.body || '') + chunk.toString();
      return true;
    });

    return { req, res, resHeaders };
  };

  it('should forward custom headers and pipe response with content disposition', (done) => {
    const { req, res, resHeaders } = createMockReqRes({ range: 'bytes=0-10' });

    res.on('finish', () => {
      expect(lastReceivedHeaders['user-agent']).toBe('MockBrowser/1.0');
      expect(lastReceivedHeaders['referer']).toBe('https://www.tiktok.com/');
      expect(lastReceivedHeaders['range']).toBe('bytes=0-10');
      expect(res.statusCode).toBe(200);
      expect(resHeaders['content-type']).toBe('video/mp4');
      expect(resHeaders['content-disposition']).toContain('attachment; filename="test_video.mp4"');
      done();
    });

    service.pipeFromCdn(
      {
        targetUrl: `${serverUrl}/stream-target`,
        headers: {
          'User-Agent': 'MockBrowser/1.0',
          Referer: 'https://www.tiktok.com/',
        },
        filename: 'test_video.mp4',
        mimeType: 'video/mp4',
      },
      req,
      res,
    );
  });

  it('should transparently follow redirects to target URL', (done) => {
    const { req, res } = createMockReqRes();

    res.on('finish', () => {
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('video bytes');
      done();
    });

    service.pipeFromCdn(
      {
        targetUrl: `${serverUrl}/redirect`,
        headers: {},
        filename: 'redirect_video.mp4',
        mimeType: 'video/mp4',
      },
      req,
      res,
    );
  });

  it('should block SSRF redirect attempts to cloud metadata IP', (done) => {
    const { req, res } = createMockReqRes();

    res.on('finish', () => {
      expect(res.statusCode).toBe(403);
      expect(res.body.message).toContain('Access to private/internal network addresses is forbidden.');
      done();
    });

    service.pipeFromCdn(
      {
        targetUrl: `${serverUrl}/redirect-ssrf`,
        headers: {},
        filename: 'ssrf_video.mp4',
        mimeType: 'video/mp4',
      },
      req,
      res,
    );
  });

  it('should return 502 if upstream returns 403 Forbidden', (done) => {
    const { req, res } = createMockReqRes();

    res.on('finish', () => {
      expect(res.statusCode).toBe(502);
      expect(res.body.message).toContain('CDN link expired');
      done();
    });

    service.pipeFromCdn(
      {
        targetUrl: `${serverUrl}/error-403`,
        headers: {},
        filename: 'forbidden.mp4',
        mimeType: 'video/mp4',
      },
      req,
      res,
    );
  });
});
