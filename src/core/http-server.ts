import express from 'express';
import cors from 'cors';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import logger from '../utils/logger.js';
import { MCP_HOST, MCP_PORT } from './config.js';
import { excalidrawMcpServerFactory } from './mcp-server.js';

export interface HttpServerHandle {
  close(): Promise<void>;
}

/**
 * Serve the MCP tools over streamable HTTP instead of stdio.
 *
 * `createMcpHandler` owns protocol-era negotiation and per-request serving;
 * `toNodeHandler` adapts its web-standard `fetch` face to Express. The handler
 * is stateless for 2025-era traffic and per-request for modern traffic, so no
 * session map needs to be maintained here.
 */
export async function runHttpServer(): Promise<HttpServerHandle> {
  const handler = createMcpHandler(excalidrawMcpServerFactory, {
    legacy: 'stateless',
    onerror: error => logger.warn('MCP HTTP handler error:', error.message)
  });

  const nodeHandler = toNodeHandler(handler, {
    onerror: error => logger.warn('MCP HTTP adapter error:', error.message)
  });

  const app = express();

  app.use(
    cors({
      exposedHeaders: ['Mcp-Session-Id', 'Mcp-Protocol-Version'],
      origin: '*'
    })
  );

  // MCP requires clients to accept both JSON and SSE. Some clients (e.g. Open
  // WebUI) send only `Accept: application/json`; widen the header so they work
  // instead of receiving a 406.
  app.use((req, _res, next) => {
    const accept = req.headers.accept;
    if (accept && !accept.includes('text/event-stream')) {
      req.headers.accept = accept.includes('application/json')
        ? `${accept}, text/event-stream`
        : 'application/json, text/event-stream';
    }
    next();
  });

  app.use(express.json({ limit: '10mb' }));

  // One endpoint for every HTTP verb the transport uses (POST for JSON-RPC,
  // GET for server-to-client streams, DELETE for session teardown).
  app.all('/mcp', (req, res) => {
    void nodeHandler(req, res, req.body);
  });

  app.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      transport: 'http',
      endpoints: ['/mcp', '/health']
    });
  });

  const httpServer = await new Promise<import('http').Server>((resolve, reject) => {
    const server = app.listen(MCP_PORT, MCP_HOST, () => resolve(server));
    server.on('error', reject);
  });

  logger.info(`Excalidraw MCP server listening on http://${MCP_HOST}:${MCP_PORT}`);

  return {
    close: async () => {
      await handler.close();
      await new Promise<void>((resolve, reject) => {
        httpServer.close(error => (error ? reject(error) : resolve()));
      });
    }
  };
}
