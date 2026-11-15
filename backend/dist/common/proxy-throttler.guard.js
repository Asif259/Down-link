"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProxyThrottlerGuard = void 0;
const common_1 = require("@nestjs/common");
const throttler_1 = require("@nestjs/throttler");
let ProxyThrottlerGuard = class ProxyThrottlerGuard extends throttler_1.ThrottlerGuard {
    async getTracker(req) {
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
};
exports.ProxyThrottlerGuard = ProxyThrottlerGuard;
exports.ProxyThrottlerGuard = ProxyThrottlerGuard = __decorate([
    (0, common_1.Injectable)()
], ProxyThrottlerGuard);
//# sourceMappingURL=proxy-throttler.guard.js.map