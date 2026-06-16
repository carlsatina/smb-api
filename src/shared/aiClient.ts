import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { AiProvider } from '@prisma/client';

export type AiTestResult =
    | { ok: true; provider: AiProvider; model: string | null; latencyMs: number }
    | { ok: false; provider: AiProvider; message: string };

export type AiModelsResult = { ok: true; models: string[] } | { ok: false; message: string };

export type AiCompletionResult = { ok: true; text: string; model: string } | { ok: false; message: string };

export interface AiTool {
    name: string;
    description: string;
    // JSON Schema object describing the tool's arguments.
    parameters: Record<string, unknown>;
    execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

export type AiChatResult = { ok: true; text: string; model: string } | { ok: false; message: string };

// Sensible defaults when the store hasn't pinned a model. Anthropic uses the
// most capable Opus tier; OpenAI uses a cheap, broadly-available chat model.
const DEFAULT_MODEL: Record<AiProvider, string> = {
    ANTHROPIC: 'claude-opus-4-8',
    OPENAI: 'gpt-4o-mini',
};

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

/**
 * Runs a single text completion against the provider. `system` carries the
 * instructions/persona; `userContent` carries the grounded data + question.
 * Returns the model's text, or a friendly error.
 */
export const generateCompletion = async (
    provider: AiProvider,
    apiKey: string,
    model: string | null,
    system: string,
    userContent: string,
    maxTokens = 1500
): Promise<AiCompletionResult> => {
    const options = { apiKey, timeout: 60_000, maxRetries: 1 };
    const useModel = model?.trim() || DEFAULT_MODEL[provider];

    try {
        if (provider === AiProvider.ANTHROPIC) {
            const client = new Anthropic(options);
            const response = await client.messages.create({
                model: useModel,
                max_tokens: maxTokens,
                system,
                messages: [{ role: 'user', content: userContent }],
            });
            const text = response.content
                .filter((block): block is Anthropic.TextBlock => block.type === 'text')
                .map((block) => block.text)
                .join('\n')
                .trim();
            return { ok: true, text, model: useModel };
        }

        const client = new OpenAI(options);
        const response = await client.chat.completions.create({
            model: useModel,
            max_tokens: maxTokens,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: userContent },
            ],
        });
        const text = (response.choices[0]?.message?.content ?? '').trim();
        return { ok: true, text, model: useModel };
    } catch (err) {
        return { ok: false, message: describeError(err) };
    }
};

const MAX_TOOL_ROUNDS = 6;

/**
 * Runs a multi-turn, tool-calling conversation against the provider. The model
 * may call any of the supplied read-only `tools` (executed server-side with the
 * store's auth context already applied); we feed results back and loop until it
 * produces a text answer. Provider-agnostic — handles Anthropic and OpenAI tool
 * loops behind one interface. `history` is the plain user/assistant transcript
 * (no tool plumbing — that lives only inside this loop).
 */
export const runToolConversation = async (
    provider: AiProvider,
    apiKey: string,
    model: string | null,
    system: string,
    history: ChatMessage[],
    tools: AiTool[],
    maxTokens = 1500
): Promise<AiChatResult> => {
    const options = { apiKey, timeout: 60_000, maxRetries: 1 };
    const useModel = model?.trim() || DEFAULT_MODEL[provider];
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    const runTool = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
        const tool = byName.get(name);
        if (!tool) return { error: `Unknown tool: ${name}` };
        try {
            return await tool.execute(args);
        } catch (err) {
            return { error: (err as { message?: string })?.message ?? 'Tool execution failed.' };
        }
    };

    try {
        if (provider === AiProvider.ANTHROPIC) {
            const anthropic = new Anthropic(options);
            const anthropicTools = tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.parameters as Anthropic.Tool.InputSchema,
            }));
            const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));

            for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
                const response = await anthropic.messages.create({
                    model: useModel,
                    max_tokens: maxTokens,
                    system,
                    tools: anthropicTools,
                    messages,
                });

                if (response.stop_reason === 'tool_use') {
                    messages.push({ role: 'assistant', content: response.content });
                    const results: Anthropic.ToolResultBlockParam[] = [];
                    for (const block of response.content) {
                        if (block.type === 'tool_use') {
                            const result = await runTool(block.name, block.input as Record<string, unknown>);
                            results.push({
                                type: 'tool_result',
                                tool_use_id: block.id,
                                content: JSON.stringify(result),
                            });
                        }
                    }
                    messages.push({ role: 'user', content: results });
                    continue;
                }

                const text = response.content
                    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
                    .map((block) => block.text)
                    .join('\n')
                    .trim();
                return { ok: true, text, model: useModel };
            }
        } else {
            const openai = new OpenAI(options);
            const openaiTools = tools.map((tool) => ({
                type: 'function' as const,
                function: { name: tool.name, description: tool.description, parameters: tool.parameters },
            }));
            const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
                { role: 'system', content: system },
                ...history.map((m) => ({ role: m.role, content: m.content })),
            ];

            for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
                const response = await openai.chat.completions.create({
                    model: useModel,
                    max_tokens: maxTokens,
                    tools: openaiTools,
                    messages,
                });
                const message = response.choices[0]?.message;

                if (message?.tool_calls?.length) {
                    messages.push({ role: 'assistant', content: message.content, tool_calls: message.tool_calls });
                    for (const call of message.tool_calls) {
                        if (call.type !== 'function') continue;
                        let args: Record<string, unknown> = {};
                        try {
                            args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
                        } catch {
                            args = {};
                        }
                        const result = await runTool(call.function.name, args);
                        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
                    }
                    continue;
                }

                return { ok: true, text: (message?.content ?? '').trim(), model: useModel };
            }
        }

        return {
            ok: true,
            text: "I couldn't finish answering that — please try asking something more specific.",
            model: useModel,
        };
    } catch (err) {
        return { ok: false, message: describeError(err) };
    }
};
