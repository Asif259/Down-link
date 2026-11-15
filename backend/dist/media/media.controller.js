"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MediaController = void 0;
const common_1 = require("@nestjs/common");
const throttler_1 = require("@nestjs/throttler");
const fs = require("fs");
const rxjs_1 = require("rxjs");
const media_dto_1 = require("./dto/media.dto");
const media_service_1 = require("./media.service");
const stream_proxy_service_1 = require("./stream-proxy.service");
const binary_service_1 = require("../binary/binary.service");
const concurrency_service_1 = require("../common/concurrency.service");
let MediaController = class MediaController {
    constructor(mediaService, streamProxyService, binaryService, concurrencyService) {
        this.mediaService = mediaService;
        this.streamProxyService = streamProxyService;
        this.binaryService = binaryService;
        this.concurrencyService = concurrencyService;
    }
    getHealth() {
        const cookiesPath = `${process.cwd()}/cookies/cookies.txt`;
        const hasCookies = fs.existsSync(cookiesPath);
        let cookieBytes = 0;
        if (hasCookies) {
            try {
                cookieBytes = fs.statSync(cookiesPath).size;
            }
            catch { }
        }
        return {
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptimeSeconds: Math.floor(process.uptime()),
            concurrency: this.concurrencyService.getStatus(),
            ytDlpPath: this.binaryService.ytDlpPath,
            cookies: {
                configured: hasCookies && cookieBytes > 10,
                bytes: cookieBytes,
            },
        };
    }
    async extract(dto) {
        return this.mediaService.extractMetadata(dto.url);
    }
    async updateCookies(dto) {
        return this.mediaService.updateMasterCookies(dto.secret, dto.cookies);
    }
    async updateBinary(dto) {
        return this.mediaService.updateBinary(dto.secret);
    }
    streamDirect(token, req, res) {
        if (!/^[a-f0-9]{32}$/.test(token)) {
            throw new common_1.BadRequestException('Invalid stream token.');
        }
        const streamOptions = this.mediaService.getStreamOptions(token);
        this.streamProxyService.pipeFromCdn(streamOptions, req, res);
    }
    streamProgress(jobId, res) {
        if (res && typeof res.setHeader === 'function') {
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('X-Accel-Buffering', 'no');
            res.setHeader('Connection', 'keep-alive');
        }
        return this.mediaService
            .getJobStream(jobId)
            .pipe((0, rxjs_1.map)((progress) => ({ data: progress })));
    }
    async download(query, req, res) {
        const abortController = new AbortController();
        const onClientClose = () => {
            if (!res.writableEnded) {
                abortController.abort();
            }
        };
        req.on('close', onClientClose);
        try {
            const { filePath, filename, mimeType } = await this.mediaService.prepareMergedFile(query.url, query.formatId, query.type, query.jobId, abortController.signal);
            if (res.writableEnded || res.destroyed) {
                if (fs.existsSync(filePath)) {
                    fs.unlink(filePath, () => { });
                }
                return;
            }
            const stat = fs.statSync(filePath);
            res.setHeader('Content-Type', mimeType);
            res.setHeader('Content-Length', stat.size);
            const asciiName = (filename.replace(/[^\x20-\x7E]/g, '_').trim() || 'media.mp4')
                .replace(/_{2,}/g, '_');
            const encodedName = encodeURIComponent(filename);
            res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`);
            const stream = fs.createReadStream(filePath);
            stream.pipe(res);
            const cleanup = () => {
                if (fs.existsSync(filePath)) {
                    fs.unlink(filePath, () => { });
                }
            };
            res.on('finish', cleanup);
            res.on('close', cleanup);
        }
        catch (err) {
            req.off('close', onClientClose);
            throw err;
        }
    }
};
exports.MediaController = MediaController;
__decorate([
    (0, throttler_1.SkipThrottle)(),
    (0, common_1.Get)('health'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], MediaController.prototype, "getHealth", null);
__decorate([
    (0, throttler_1.Throttle)({ heavy: { limit: 10, ttl: 60000 } }),
    (0, common_1.Post)('extract'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [media_dto_1.ExtractMediaDto]),
    __metadata("design:returntype", Promise)
], MediaController.prototype, "extract", null);
__decorate([
    (0, throttler_1.SkipThrottle)(),
    (0, common_1.Post)('cookies'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [media_dto_1.UpdateCookiesDto]),
    __metadata("design:returntype", Promise)
], MediaController.prototype, "updateCookies", null);
__decorate([
    (0, throttler_1.SkipThrottle)(),
    (0, common_1.Post)('update-binary'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [media_dto_1.UpdateBinaryDto]),
    __metadata("design:returntype", Promise)
], MediaController.prototype, "updateBinary", null);
__decorate([
    (0, throttler_1.Throttle)({ default: { limit: 15, ttl: 60000 } }),
    (0, common_1.Get)('stream/:token'),
    __param(0, (0, common_1.Param)('token')),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], MediaController.prototype, "streamDirect", null);
__decorate([
    (0, throttler_1.SkipThrottle)(),
    (0, common_1.Sse)('progress/:jobId'),
    __param(0, (0, common_1.Param)('jobId')),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", rxjs_1.Observable)
], MediaController.prototype, "streamProgress", null);
__decorate([
    (0, throttler_1.Throttle)({ heavy: { limit: 4, ttl: 60000 } }),
    (0, common_1.Get)('download'),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [media_dto_1.DownloadQueryDto, Object, Object]),
    __metadata("design:returntype", Promise)
], MediaController.prototype, "download", null);
exports.MediaController = MediaController = __decorate([
    (0, common_1.Controller)('api/media'),
    __metadata("design:paramtypes", [media_service_1.MediaService,
        stream_proxy_service_1.StreamProxyService,
        binary_service_1.BinaryService,
        concurrency_service_1.ConcurrencyService])
], MediaController);
//# sourceMappingURL=media.controller.js.map