"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var TempCleanupService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TempCleanupService = void 0;
const common_1 = require("@nestjs/common");
const fs = require("fs");
const path = require("path");
let TempCleanupService = TempCleanupService_1 = class TempCleanupService {
    constructor() {
        this.logger = new common_1.Logger(TempCleanupService_1.name);
        this.tempDir = path.join(process.cwd(), 'temp');
        this.maxMediaAgeMs = 15 * 60 * 1000;
        this.maxCookieAgeMs = 5 * 60 * 1000;
        this.sweepIntervalMs = 10 * 60 * 1000;
    }
    onModuleInit() {
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
        this.sweepStaleFiles(true);
        this.sweepTimer = setInterval(() => {
            this.sweepStaleFiles(false);
        }, this.sweepIntervalMs);
        this.sweepTimer.unref();
    }
    onModuleDestroy() {
        if (this.sweepTimer) {
            clearInterval(this.sweepTimer);
        }
    }
    sweepStaleFiles(isStartup = false) {
        if (!fs.existsSync(this.tempDir))
            return 0;
        const now = Date.now();
        let removedCount = 0;
        try {
            const files = fs.readdirSync(this.tempDir);
            for (const file of files) {
                if (file === '.gitkeep' || file === '.cache')
                    continue;
                const fullPath = path.join(this.tempDir, file);
                try {
                    const stat = fs.statSync(fullPath);
                    if (!stat.isFile()) {
                        if (file.startsWith('_MEI')) {
                            const ageMs = now - stat.mtimeMs;
                            if (isStartup || ageMs > this.maxMediaAgeMs) {
                                fs.rmSync(fullPath, { recursive: true, force: true });
                                removedCount++;
                            }
                        }
                        continue;
                    }
                    const ageMs = now - stat.mtimeMs;
                    const isTempCookie = file.startsWith('cookie_') && file.endsWith('.txt');
                    const threshold = isTempCookie ? this.maxCookieAgeMs : this.maxMediaAgeMs;
                    if (isStartup || ageMs > threshold) {
                        fs.unlinkSync(fullPath);
                        removedCount++;
                    }
                }
                catch {
                }
            }
            if (removedCount > 0) {
                this.logger.log(`Swept ${removedCount} stale temporary file(s) from disk.`);
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            this.logger.warn(`Temp directory sweep error: ${msg}`);
        }
        return removedCount;
    }
};
exports.TempCleanupService = TempCleanupService;
exports.TempCleanupService = TempCleanupService = TempCleanupService_1 = __decorate([
    (0, common_1.Injectable)()
], TempCleanupService);
//# sourceMappingURL=temp-cleanup.service.js.map