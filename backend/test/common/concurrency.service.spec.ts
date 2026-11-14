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
    expect(maxSeenConcurrent).toBeLessThanOrEqual(3);
    expect(maxSeenConcurrent).toBe(3);
    expect(currentConcurrent).toBe(0);
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
