export {};

const baseUrl = process.env.SMOKE_BASE_URL || `http://localhost:${process.env.PORT || 9000}`;
const smokeEmail = process.env.SMOKE_EMAIL;
const smokePassword = process.env.SMOKE_PASSWORD;

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

    const meRes = await fetch(`${baseUrl}/api/v1/auth/me`);
    if (meRes.status !== 401) {
        throw new Error(`Expected auth to reject anonymous access, got ${meRes.status}`);
    }

    if (smokeEmail || smokePassword) {
        if (!smokeEmail || !smokePassword) {
            throw new Error('SMOKE_EMAIL and SMOKE_PASSWORD must be set together.');
        }
        const token = await login(smokeEmail, smokePassword);
        const authHeaders = { Authorization: `Bearer ${token}` };

        const authedMeRes = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: authHeaders });
        if (!authedMeRes.ok) {
            throw new Error(`Expected auth/me to succeed, got ${authedMeRes.status}`);
        }

        const storesRes = await fetch(`${baseUrl}/api/v1/stores`, { headers: authHeaders });
        if (!storesRes.ok) {
            throw new Error(`Expected stores list to succeed, got ${storesRes.status}`);
        }
    }

    console.log('Smoke test passed.');
};

run().catch((error) => {
    console.error('Smoke test failed.', error);
    process.exit(1);
});
