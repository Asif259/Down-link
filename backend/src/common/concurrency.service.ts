import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

export interface ConcurrencyStatus {
  activeCount: number;
  queueLength: number;
  maxConcurrent: number;
  maxQueueLength: number;
}

@Injectable()
export class ConcurrencyService {
  private readonly logger = new Logger(ConcurrencyService.name);
  private activeCount = 0;
  private maxConcurrent = 3;
  private maxQueueLength = 20;
  private readonly queue: Array<() => void> = [];

  constructor() {}

  configure(maxConcurrent: number, maxQueueLength: number): this {
    this.maxConcurrent = maxConcurrent;
    this.maxQueueLength = maxQueueLength;
    return this;
  }

  getStatus(): ConcurrencyStatus {
    return {
      activeCount: this.activeCount,
      queueLength: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      maxQueueLength: this.maxQueueLength,
    };
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.maxConcurrent) {
      if (this.queue.length >= this.maxQueueLength) {
        this.logger.warn(
          `Task rejected: concurrency queue is full (${this.queue.length}/${this.maxQueueLength} queued, ${this.activeCount} active)`,
        );
        throw new ServiceUnavailableException(
          'Server is currently handling peak traffic. Please try again in a few moments.',
        );
      }
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }

    this.activeCount++;
    try {
      return await task();
    } finally {
      this.activeCount--;
      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }
}
