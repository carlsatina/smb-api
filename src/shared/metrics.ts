type StatusCounts = Record<string, number>;

type RouteMetric = {
    count: number;
    errorCount: number;
    totalDurationMs: number;
    minDurationMs: number;
    maxDurationMs: number;
    statusCounts: StatusCounts;
};

type ProcessHealth = {
    eventLoopLagMs: { max: number; average: number; samples: number };
    memoryMb: { heapUsed: number; heapTotal: number; rss: number; external: number };
    cpuPercentOfOneCore: number;
    activeHandles: number | null;
    nodeVersion: string;
};

type MetricsSnapshot = {
    startedAt: string;
    uptimeSeconds: number;
    process: ProcessHealth;
    totals: {
        requests: number;
        errors: number;
        averageDurationMs: number;
        statusCounts: StatusCounts;
    };
    routes: Array<{
        key: string;
        count: number;
        errorCount: number;
        averageDurationMs: number;
        minDurationMs: number;
        maxDurationMs: number;
        statusCounts: StatusCounts;
    }>;
};

// Event-loop lag: a timer asked to fire every 500ms, and however late it
// actually fires is time the loop was blocked. This is the signal that explains
// a whole class of problem a request timer cannot -- synchronous work on the
// main thread (password hashing, a large JSON serialisation, a hot loop) makes
// EVERY concurrent request slow while showing up in none of their own timings.
const LAG_INTERVAL_MS = 500;
let lagMaxMs = 0;
let lagSumMs = 0;
let lagSamples = 0;
let lastTick = process.hrtime.bigint();

const lagTimer = setInterval(() => {
    const now = process.hrtime.bigint();
    const actualMs = Number(now - lastTick) / 1e6;
    const lateBy = Math.max(0, actualMs - LAG_INTERVAL_MS);
    lastTick = now;
    lagMaxMs = Math.max(lagMaxMs, lateBy);
    lagSumMs += lateBy;
    lagSamples += 1;
}, LAG_INTERVAL_MS);

// Never hold the process open for a metric.
lagTimer.unref();

let lastCpu = process.cpuUsage();
let lastCpuAt = Date.now();

const startedAt = Date.now();
const metricsState = {
    totalRequests: 0,
    totalErrors: 0,
    totalDurationMs: 0,
    statusCounts: {} as StatusCounts,
    routes: new Map<string, RouteMetric>(),
};

const statusBucket = (status: number) => `${Math.floor(status / 100)}xx`;

const incrementStatus = (counts: StatusCounts, status: number) => {
    const bucket = statusBucket(status);
    counts[bucket] = (counts[bucket] ?? 0) + 1;
};

export const recordRequest = (input: {
    method: string;
    path: string;
    status: number;
    durationMs: number;
}) => {
    metricsState.totalRequests += 1;
    metricsState.totalDurationMs += input.durationMs;

    if (input.status >= 500) {
        metricsState.totalErrors += 1;
    }

    incrementStatus(metricsState.statusCounts, input.status);

    const key = `${input.method.toUpperCase()} ${input.path}`;
    const existing = metricsState.routes.get(key);

    if (!existing) {
        metricsState.routes.set(key, {
            count: 1,
            errorCount: input.status >= 500 ? 1 : 0,
            totalDurationMs: input.durationMs,
            minDurationMs: input.durationMs,
            maxDurationMs: input.durationMs,
            statusCounts: {
                [statusBucket(input.status)]: 1,
            },
        });
        return;
    }

    existing.count += 1;
    existing.totalDurationMs += input.durationMs;
    existing.minDurationMs = Math.min(existing.minDurationMs, input.durationMs);
    existing.maxDurationMs = Math.max(existing.maxDurationMs, input.durationMs);
    if (input.status >= 500) {
        existing.errorCount += 1;
    }
    incrementStatus(existing.statusCounts, input.status);
};

/**
 * Process health at this instant.
 *
 * Latency measured from outside says what is slow. These say why: whether the
 * loop is blocked, whether memory is climbing, whether the CPU is saturated.
 */
const getProcessHealth = () => {
    const mem = process.memoryUsage();

    // CPU as a percentage of one core since the previous call, which is what
    // makes consecutive samples during a load test comparable.
    const now = Date.now();
    const cpu = process.cpuUsage(lastCpu);
    const elapsedMs = Math.max(1, now - lastCpuAt);
    lastCpu = process.cpuUsage();
    lastCpuAt = now;
    const cpuPercent = ((cpu.user + cpu.system) / 1000 / elapsedMs) * 100;

    const health = {
        eventLoopLagMs: {
            // Reported since the previous snapshot, then reset, so a reading
            // belongs to the window it was taken over rather than to all of
            // history.
            max: Math.round(lagMaxMs * 100) / 100,
            average: lagSamples > 0 ? Math.round((lagSumMs / lagSamples) * 100) / 100 : 0,
            samples: lagSamples,
        },
        memoryMb: {
            heapUsed: Math.round((mem.heapUsed / 1048576) * 10) / 10,
            heapTotal: Math.round((mem.heapTotal / 1048576) * 10) / 10,
            rss: Math.round((mem.rss / 1048576) * 10) / 10,
            external: Math.round((mem.external / 1048576) * 10) / 10,
        },
        cpuPercentOfOneCore: Math.round(cpuPercent * 10) / 10,
        activeHandles: (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.().length ?? null,
        nodeVersion: process.version,
    };

    lagMaxMs = 0;
    lagSumMs = 0;
    lagSamples = 0;

    return health;
};

export const getMetricsSnapshot = (limit?: number): MetricsSnapshot => {
    const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
    const averageDurationMs =
        metricsState.totalRequests > 0 ? metricsState.totalDurationMs / metricsState.totalRequests : 0;

    const routes = Array.from(metricsState.routes.entries())
        .map(([key, route]) => ({
            key,
            count: route.count,
            errorCount: route.errorCount,
            averageDurationMs: route.totalDurationMs / route.count,
            minDurationMs: route.minDurationMs,
            maxDurationMs: route.maxDurationMs,
            statusCounts: route.statusCounts,
        }))
        .sort((a, b) => b.count - a.count);

    const sliced = limit && limit > 0 ? routes.slice(0, limit) : routes;

    return {
        startedAt: new Date(startedAt).toISOString(),
        uptimeSeconds,
        process: getProcessHealth(),
        totals: {
            requests: metricsState.totalRequests,
            errors: metricsState.totalErrors,
            averageDurationMs,
            statusCounts: metricsState.statusCounts,
        },
        routes: sliced,
    };
};
