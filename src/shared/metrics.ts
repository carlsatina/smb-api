type StatusCounts = Record<string, number>;

type RouteMetric = {
    count: number;
    errorCount: number;
    totalDurationMs: number;
    minDurationMs: number;
    maxDurationMs: number;
    statusCounts: StatusCounts;
};

type MetricsSnapshot = {
    startedAt: string;
    uptimeSeconds: number;
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
        totals: {
            requests: metricsState.totalRequests,
            errors: metricsState.totalErrors,
            averageDurationMs,
            statusCounts: metricsState.statusCounts,
        },
        routes: sliced,
    };
};
