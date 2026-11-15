"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectPlatform = detectPlatform;
function detectPlatform(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return 'unknown';
        }
        const hostname = parsed.hostname.toLowerCase();
        if (/(^|\.)youtube\.com$/i.test(hostname) || /(^|\.)youtu\.be$/i.test(hostname)) {
            return 'youtube';
        }
        if (/(^|\.)facebook\.com$/i.test(hostname) || /(^|\.)fb\.watch$/i.test(hostname)) {
            return 'facebook';
        }
        if (/(^|\.)instagram\.com$/i.test(hostname)) {
            return 'instagram';
        }
        if (/(^|\.)tiktok\.com$/i.test(hostname)) {
            return 'tiktok';
        }
        return 'unknown';
    }
    catch {
        return 'unknown';
    }
}
//# sourceMappingURL=platform.util.js.map