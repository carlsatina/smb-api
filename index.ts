import { createApp } from './src/app';
import { env } from './src/config/env';
import { initErrorReporting } from './src/shared/errorReporting';

initErrorReporting();

const app = createApp();

app.listen(env.port, () => {
    console.log(`⚡️[server]: Server is running at http://localhost:${env.port}`);
});
