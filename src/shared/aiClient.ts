import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { AiProvider } from '@prisma/client';

export type AiTestResult =
    | { ok: true; provider: AiProvider; model: string | null; latencyMs: number }
    | { ok: false; provider: AiProvider; message: string };

export type AiModelsResult = { ok: true; models: string[] } | { ok: false; message: string };

// Turn a provider SDK error into a short, user-facing message.
const describeError = (err: unknown): string => {
    const status = (err as { status?: number })?.status;
    if (status === 401) return 'Invalid API key.';
    if (status === 403) return 'API key lacks permission for this resource.';
    if (status === 404) return 'Model not found for this key.';
    if (status === 429) return 'Rate limited by the provider. Try again shortly.';
    if (typeof status === 'number' && status >= 500) return 'The provider is temporarily unavailable.';
    const message = (err as { message?: string })?.message;
    return message ? `Connection failed: ${message}` : 'Connection failed.';
};

/**
 * Validates an AI provider API key (and, when given, a specific model) by
 * calling the provider's Models API. This costs no tokens — it only checks
 * that the key authenticates and the model is reachable. Network calls are
 * bounded by a short timeout with no retries so the request fails fast.
 */
export const testAiConnection = async (
    provider: AiProvider,
    apiKey: string,
    model: string | null
): Promise<AiTestResult> => {
    const start = Date.now();
    const options = { apiKey, timeout: 10_000, maxRetries: 0 };

    try {
        if (provider === AiProvider.ANTHROPIC) {
            const client = new Anthropic(options);
            if (model) await client.models.retrieve(model);
            else await client.models.list();
        } else {
            const client = new OpenAI(options);
            if (model) await client.models.retrieve(model);
            else await client.models.list();
        }
        return { ok: true, provider, model: model ?? null, latencyMs: Date.now() - start };
    } catch (err) {
        return { ok: false, provider, message: describeError(err) };
    }
};

/**
 * Lists the model IDs available to the given provider key, via the provider's
 * Models API (no tokens consumed). Returns IDs sorted alphabetically.
 */
export const listAiModels = async (provider: AiProvider, apiKey: string): Promise<AiModelsResult> => {
    const options = { apiKey, timeout: 10_000, maxRetries: 0 };
    const ids: string[] = [];

    try {
        if (provider === AiProvider.ANTHROPIC) {
            const client = new Anthropic(options);
            for await (const model of client.models.list()) ids.push(model.id);
        } else {
            const client = new OpenAI(options);
            for await (const model of client.models.list()) ids.push(model.id);
        }
        return { ok: true, models: ids.sort() };
    } catch (err) {
        return { ok: false, message: describeError(err) };
    }
};
