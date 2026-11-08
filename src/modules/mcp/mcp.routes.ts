import { createHash } from 'crypto';
import { Request, Response, Router } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createRateLimiter } from '../../middlewares/rateLimit';
import { AppError } from '../../shared/errors';
import { logger } from '../../shared/logger';
import { resolveMcpToken, McpContext } from './mcp.auth';
import { registerMcpTools } from './mcp.tools';

export const mcpRouter = Router();

// Keyed by token so one busy AI client can't starve the others on a shared IP.
const mcpLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 120,
    message: 'Too many MCP requests. Please slow down.',
    keyGenerator: (req) => {
        const auth = req.headers.authorization;
        return auth ? `mcp:${createHash('sha256').update(auth).digest('hex').slice(0, 32)}` : `mcp-ip:${req.ip}`;
    },
});

const rpcError = (res: Response, status: number, code: number, message: string) => {
    res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
};

const buildServer = (context: McpContext) => {
    const canWrite = context.access === 'READ_WRITE';
    const server = new McpServer(
        { name: 'smb-pos', title: 'SMB-PoS', version: '1.0.0' },
        {
            instructions: [
                context.stores.length === 1
                    ? `You are connected to the SMB-PoS store "${context.stores[0].name}" (amounts in ${context.stores[0].currency}).`
                    : `You are connected to ${context.stores.length} SMB-PoS stores: ${context.stores.map((s) => `"${s.name}" (${s.currency})`).join(', ')}. Call list_stores for their ids and pass storeId to every other tool; ask the user which store they mean when it is unclear.`,
                'You can read the store settings, ingredients, products and recipes. Sales, payments, team members and stock levels are not available.',
                canWrite
                    ? 'This token can create and update ingredients, products and recipes. Changes apply to the live POS immediately and are recorded in the store audit log, so confirm price and recipe changes with the user before making them.'
                    : 'This token is read-only: you cannot change anything.',
                'Store settings are read-only. Use get_store_settings for the valid units, categories and subcategories before creating products.',
            ].join(' '),
        }
    );
    registerMcpTools(server, context);
    return server;
};

// Stateless Streamable HTTP: every POST is authenticated and served by a fresh
// server instance, so a revoked token stops working on its next call.
mcpRouter.post('/', mcpLimiter, async (req: Request, res: Response) => {
    let context: McpContext;
    try {
        context = await resolveMcpToken(req.headers.authorization);
    } catch (error) {
        if (error instanceof AppError) {
            res.setHeader('WWW-Authenticate', 'Bearer realm="smb-pos-mcp"');
            const status = error.statusCode === 402 ? 402 : error.statusCode === 403 ? 403 : 401;
            return rpcError(res, status, -32001, error.message);
        }
        logger.error('MCP auth failed', { error: error instanceof Error ? error.message : String(error) });
        return rpcError(res, 500, -32603, 'Internal server error');
    }

    const server = buildServer(context);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
        transport.close().catch(() => undefined);
        server.close().catch(() => undefined);
    });

    try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    } catch (error) {
        logger.error('MCP request failed', { error: error instanceof Error ? error.message : String(error) });
        if (!res.headersSent) rpcError(res, 500, -32603, 'Internal server error');
    }
});

// No server-initiated streams or sessions in stateless mode.
mcpRouter.get('/', (_req, res) => rpcError(res, 405, -32000, 'Method not allowed.'));
mcpRouter.delete('/', (_req, res) => rpcError(res, 405, -32000, 'Method not allowed.'));
