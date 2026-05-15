export {};

const baseUrl = process.env.MONITOR_BASE_URL || process.env.SMOKE_BASE_URL || `http://localhost:${process.env.PORT || 3500}`;
const adminEmail = process.env.MONITOR_ADMIN_EMAIL;
const adminPassword = process.env.MONITOR_ADMIN_PASSWORD;
const errorRateThreshold = Number(process.env.MONITOR_ERROR_RATE_THRESHOLD ?? 0.05);
const minRequests = Number(process.env.MONITOR_MIN_REQUESTS ?? 20);

const getJson = async (response: Response) => {
    try {
        return await response.json();
    } catch {
        return null;
    }
};

const login = async (email: string, password: string) => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
        const data = await getJson(res);
        throw new Error(`Login failed: ${res.status} ${data?.error?.message ?? ''}`.trim());
    }
    const data = await getJson(res);
    if (!data?.accessToken) {
        throw new Error('Login response missing accessToken.');
    }
    return data.accessToken as string;
};

const run = async () => {
    const healthRes = await fetch(`${baseUrl}/health`);
    if (!healthRes.ok) {
        throw new Error(`Health check failed: ${healthRes.status}`);
    }

    if (adminEmail || adminPassword) {
        if (!adminEmail || !adminPassword) {
            throw new Error('MONITOR_ADMIN_EMAIL and MONITOR_ADMIN_PASSWORD must be set together.');
        }
        const token = await login(adminEmail, adminPassword);
        const metricsRes = await fetch(`${baseUrl}/api/v1/admin/metrics`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!metricsRes.ok) {
            throw new Error(`Metrics check failed: ${metricsRes.status}`);
        }
        const data = await getJson(metricsRes);
        const totals = data?.metrics?.totals;
        if (!totals) {
            throw new Error('Metrics response missing totals.');
        }
        const totalRequests = Number(totals.requests ?? 0);
        const totalErrors = Number(totals.errors ?? 0);
        if (totalRequests >= minRequests && totalRequests > 0) {
            const errorRate = totalErrors / totalRequests;
            if (errorRate > errorRateThreshold) {
                throw new Error(
                    `Error rate ${Math.round(errorRate * 100)}% exceeds threshold ${Math.round(errorRateThreshold * 100)}%.`
                );
            }
        }
    }

    console.log('Monitoring check passed.');
};

run().catch((error) => {
    console.error('Monitoring check failed.', error);
    process.exit(1);
});
