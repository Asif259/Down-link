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
var ConcurrencyService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConcurrencyService = void 0;
const common_1 = require("@nestjs/common");
let ConcurrencyService = ConcurrencyService_1 = class ConcurrencyService {
    constructor() {
        this.logger = new common_1.Logger(ConcurrencyService_1.name);
        this.activeCount = 0;
        this.maxConcurrent = 3;
        this.maxQueueLength = 20;
        this.queue = [];
    }
    configure(maxConcurrent, maxQueueLength) {
        this.maxConcurrent = maxConcurrent;
        this.maxQueueLength = maxQueueLength;
        return this;
    }
    getStatus() {
        return {
            activeCount: this.activeCount,
            queueLength: this.queue.length,
            maxConcurrent: this.maxConcurrent,
            maxQueueLength: this.maxQueueLength,
        };
    }
    async run(task) {
        if (this.activeCount >= this.maxConcurrent) {
            if (this.queue.length >= this.maxQueueLength) {
                this.logger.warn(`Task rejected: concurrency queue is full (${this.queue.length}/${this.maxQueueLength} queued, ${this.activeCount} active)`);
                throw new common_1.ServiceUnavailableException('Server is currently handling peak traffic. Please try again in a few moments.');
            }
            await new Promise((resolve) => this.queue.push(resolve));
        }
        this.activeCount++;
        try {
            return await task();
        }
        finally {
            this.activeCount--;
            const next = this.queue.shift();
            if (next) {
                next();
            }
        }
    }
};
exports.ConcurrencyService = ConcurrencyService;
exports.ConcurrencyService = ConcurrencyService = ConcurrencyService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], ConcurrencyService);
//# sourceMappingURL=concurrency.service.js.map