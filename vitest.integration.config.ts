import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/integration/**/*.test.ts'],
        setupFiles: ['tests/setup/setupEnv.ts'],
        globalSetup: ['tests/setup/globalSetup.ts'],
        pool: 'forks',
        poolOptions: {
            forks: {
                singleFork: true,
            },
        },
        fileParallelism: false,
        sequence: {
            concurrent: false,
        },
        testTimeout: 30000,
    },
});
