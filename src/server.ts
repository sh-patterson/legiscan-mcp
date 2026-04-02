// Server factory — extracted from index.ts for testability

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { LegiScanClient } from "./legiscan-client.js";
import { registerSessionTools } from "./tools/sessions.js";
import { registerBillTools } from "./tools/bills.js";
import { registerPeopleTools } from "./tools/people.js";
import { registerSearchTools } from "./tools/search.js";
import { registerCompositeTools } from "./tools/composite.js";

export const SERVER_INSTRUCTIONS = `This server provides US legislative data. Users ask questions in plain language.

IMPORTANT: Never ask the user for internal IDs (people_id, bill_id, session_id, roll_call_id). Resolve them:
- Legislator name → legiscan_find_legislator (returns people_id)
- Bill number like "AB 858" → legiscan_find_bill_by_number (returns bill_id)
- State name → two-letter code (California → CA)
- Session → reuse session.session_id from prior tool results when available. Bill lookups can resolve the current session from state, but author/vote workflows should keep passing the same state or session_id forward.

Common chains:
- "How did X vote on Y?" → legiscan_find_legislator → legiscan_search → legiscan_get_legislator_votes
- "What bills did X author?" → legiscan_find_legislator → legiscan_get_primary_authored using the returned session.session_id or state
- "What's happening with [topic]?" → legiscan_search → legiscan_get_bill for top results`;

/**
 * Create and configure the MCP server with all tools registered.
 * Separated from transport/startup logic so tests can inspect tools and instructions.
 */
export function createServer(apiKey: string): McpServer {
  const client = new LegiScanClient(apiKey);

  const server = new McpServer(
    { name: "legiscan", version: "1.0.0" },
    { instructions: SERVER_INSTRUCTIONS }
  );

  registerCompositeTools(server, client);
  registerBillTools(server, client);
  registerPeopleTools(server, client);
  registerSearchTools(server, client);
  registerSessionTools(server, client);

  return server;
}
