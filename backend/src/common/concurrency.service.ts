import { Injectable } from '@nestjs/common';

@Injectable()
export class ConcurrencyService {
  private activeCount = 0;
  private readonly maxConcurrent = 3;
  private readonly queue: Array<() => void> = [];

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.activeCount++;
    try {
      return await task();
    } finally {
      this.activeCount--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}
