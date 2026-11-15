import { ServiceUnavailableException } from '@nestjs/common';
import { ConcurrencyService } from '../../src/common/concurrency.service';

describe('ConcurrencyService', () => {
  let service: ConcurrencyService;

  beforeEach(() => {
    service = new ConcurrencyService();
  });

  it('should run single tasks immediately', async () => {
    const result = await service.run(async () => 42);
    expect(result).toBe(42);
  });

  it('should cap active concurrent tasks at 3 and queue remaining tasks', async () => {
    let currentConcurrent = 0;
    let maxSeenConcurrent = 0;

    const createTask = (id: number, delayMs: number) => {
      return service.run(async () => {
        currentConcurrent++;
        if (currentConcurrent > maxSeenConcurrent) {
          maxSeenConcurrent = currentConcurrent;
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        currentConcurrent--;
        return id;
      });
    };

    const taskPromises = [
      createTask(1, 60),
      createTask(2, 60),
      createTask(3, 60),
      createTask(4, 30),
      createTask(5, 30),
    ];

    const results = await Promise.all(taskPromises);
    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(maxSeenConcurrent).toBe(3);
    expect(currentConcurrent).toBe(0);
  });

  it('should reject tasks with ServiceUnavailableException when queue is full', async () => {
    // Service with custom small queue capacity: maxConcurrent: 1, maxQueue: 2
    const smallService = new ConcurrencyService().configure(1, 2);

    // 1 active task
    const activePromise = smallService.run(
      () => new Promise((resolve) => setTimeout(resolve, 100)),
    );

    // 2 queued tasks
    const queued1 = smallService.run(async () => 'q1');
    const queued2 = smallService.run(async () => 'q2');

    // 4th task exceeds queue limit (maxQueue: 2) -> must throw 503
    await expect(smallService.run(async () => 'overflow')).rejects.toThrow(
      ServiceUnavailableException,
    );

    await Promise.all([activePromise, queued1, queued2]);
  });

  it('should report accurate status telemetry', async () => {
    const statusBefore = service.getStatus();
    expect(statusBefore.activeCount).toBe(0);
    expect(statusBefore.queueLength).toBe(0);
    expect(statusBefore.maxConcurrent).toBe(3);
    expect(statusBefore.maxQueueLength).toBe(20);
  });

  it('should release queue even if task throws', async () => {
    await expect(
      service.run(async () => {
        throw new Error('Task failure');
      }),
    ).rejects.toThrow('Task failure');

    const nextResult = await service.run(async () => 'recovered');
    expect(nextResult).toBe('recovered');
  });
});
