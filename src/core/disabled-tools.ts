import logger from '../utils/logger.js';
import { tools } from './mcp-tools.js';

// Comma-separated MCP tool names to hide from `tools/list` and
// `server/discover`. Opt-in: unset/empty keeps every tool.
//
//   DISABLED_TOOLS=get_canvas_screenshot
//
// The tool table in mcp-tools.ts stays untouched, so upstream merges only need
// to re-apply the small registration filter in mcp-server.ts.
const disabledToolNames = new Set(
  (process.env.DISABLED_TOOLS ?? '')
    .split(',')
    .map(name => name.trim())
    .filter(name => name.length > 0)
);

const knownToolNames = new Set(tools.map(tool => tool.name));
const unknownToolNames = [...disabledToolNames].filter(name => !knownToolNames.has(name));
if (unknownToolNames.length > 0) {
  logger.warn(`DISABLED_TOOLS contains unknown tool name(s): ${unknownToolNames.join(', ')}`);
}

export const enabledTools = tools.filter(tool => !disabledToolNames.has(tool.name));

export function isToolDisabled(name: string): boolean {
  return disabledToolNames.has(name);
}
