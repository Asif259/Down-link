export interface ConcurrencyStatus {
    activeCount: number;
    queueLength: number;
    maxConcurrent: number;
    maxQueueLength: number;
}
export declare class ConcurrencyService {
    private readonly logger;
    private activeCount;
    private maxConcurrent;
    private maxQueueLength;
    private readonly queue;
    constructor();
    configure(maxConcurrent: number, maxQueueLength: number): this;
    getStatus(): ConcurrencyStatus;
    run<T>(task: () => Promise<T>): Promise<T>;
}
