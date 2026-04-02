# LegiScan MCP Server

[![CI](https://github.com/sh-patterson/legiscan-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/sh-patterson/legiscan-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)

A Model Context Protocol (MCP) server that gives terminal agents structured access to the [LegiScan API](https://legiscan.com/) for legislative data from all 50 US states and Congress.

Built for research workflows where you direct an agent (Codex, Claude Code, Claude Desktop, etc.) to gather bill history, sponsor context, and voting records quickly.

## Features

- **10 Streamlined MCP Tools** optimized for legislative research workflows
- **Composite tools** that collapse multi-step research workflows into single MCP tool calls
- Per-request batching and lookup caching for repeated bill and roll-call lookups
- Full TypeScript type definitions for all API responses
- Bill number normalization (handles AB 858, AB858, AB-858 formats)
- Input validation guardrails for state codes, legislator name queries, and large bill batches

## Installation

### From npm (Recommended)

```bash
npm install -g legiscan-mcp-server
```

### From Source

```bash
git clone https://github.com/sh-patterson/legiscan-mcp.git
cd legiscan-mcp
npm install
npm run build
```

## Setup

### 1. Get a LegiScan API Key

1. Create a free account at [LegiScan](https://legiscan.com/)
2. Register for API access at https://legiscan.com/legiscan
3. Copy your API key

### 2. Add to Your MCP-Capable Agent

Add this server to whatever MCP host your terminal agent uses.

Claude Desktop config paths:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

For other MCP clients (Codex CLI, Claude Code, etc.), add the same `mcpServers.legiscan` entry in that client's MCP config file.

#### Using npx (Recommended)

```json
{
  "mcpServers": {
    "legiscan": {
      "command": "npx",
      "args": ["-y", "legiscan-mcp-server"],
      "env": {
        "LEGISCAN_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

#### Using local installation

```json
{
  "mcpServers": {
    "legiscan": {
      "command": "node",
      "args": ["/path/to/legiscan-mcp-server/dist/index.js"],
      "env": {
        "LEGISCAN_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

## Available Tools

### Composite Tools (High-Level Research)
| Tool | Description |
|------|-------------|
| `legiscan_find_legislator` | Find a legislator's people_id by name. Supports partial matching. |
| `legiscan_get_legislator_votes` | Get how a legislator voted on multiple bills in one call. |
| `legiscan_get_primary_authored` | Get only bills where legislator is primary author (not co-sponsor). |

### Bills
| Tool | Description |
|------|-------------|
| `legiscan_get_bill` | Get detailed bill info (sponsors, history, votes, texts) |
| `legiscan_find_bill_by_number` | Find bill by number (handles AB 858, AB858, AB-858, A.B. 858). Best for exact bill lookup. |
| `legiscan_get_roll_call` | Get vote details with individual legislator votes |

### People
| Tool | Description |
|------|-------------|
| `legiscan_get_person` | Get legislator info with third-party IDs (VoteSmart, OpenSecrets, etc.) |
| `legiscan_get_session_people` | Get all legislators active in a session |

### Search
| Tool | Description |
|------|-------------|
| `legiscan_search` | Full-text search across legislation. Accepts bill-number variants like AB858, but use `legiscan_find_bill_by_number` for exact matches. |

### Sessions
| Tool | Description |
|------|-------------|
| `legiscan_get_session_list` | List available legislative sessions by state |

## Researcher Workflow (Terminal Agent)

### 1. Start with a scoped request
Give your agent a goal, state, timeframe, and output format.

Example prompt:

```text
Use the LegiScan MCP tools to find major California housing bills in the current session.
Return: bill number, title, latest action date, top sponsors, and whether there was a close roll-call vote (margin <= 5).
```

### 2. Ask the agent to follow a tool sequence
For high-quality results, tell the agent to do this order:

1. `legiscan_get_session_list` to identify the correct session.
2. `legiscan_search` or `legiscan_find_bill_by_number` to locate target bills.
3. `legiscan_get_bill` for sponsor/history/vote references.
4. `legiscan_get_roll_call` for individual vote details.
5. `legiscan_get_person` only when legislator enrichment is needed.

If you start with `legiscan_find_legislator`, keep passing the returned `session.session_id` or the same `state` into follow-up authoring workflows so results stay in the intended legislature and timeframe.

### 3. Reuse composite tools for analyst workflows
These cut tool-call volume and simplify instructions to your agent:

- `legiscan_find_legislator`: get `people_id` from a name query.
- `legiscan_get_primary_authored`: separate primary-authored from co-sponsored bills.
- `legiscan_get_legislator_votes`: pull vote positions across many bills in one request.

## Prompt Templates

### A) Opposition research on one legislator

```text
Use LegiScan MCP for Texas.
1) Find legislator "Jane Smith".
2) List all primary-authored bills in the current session.
3) For these bills, summarize topic area and latest status.
4) Then check votes on SB 12, HB 301, and SB 455, and show how the legislator voted.
```

### B) Bill tracking brief for an issue area

```text
Use LegiScan MCP to track "climate resilience" bills in New York.
Focus on current session only.
Return top 15 bills by relevance with bill number, title, last action, sponsor party, and any recorded roll calls.
```

### C) Scorecard support workflow

```text
For California session 2172, resolve bill numbers AB 858, SB 525, SB 616, SB 399.
For each bill, fetch details and any roll calls.
Then report vote positions for people_id values 21719, 23214, and 25359.
Output as a table suitable for CSV export.
```

## Workflow Simplification

The composite tools dramatically reduce agent-to-tool round trips for common workflows:

| Workflow | Manual MCP Steps | With Composites |
|----------|------------------|-----------------|
| Get votes for 1 legislator on 10 bills | Find legislator → search/resolve bills → inspect each bill → inspect each roll call | 1 tool call once you have `bill_ids` |
| Filter primary authored from 150 sponsored bills | Sponsored list → fetch each bill → inspect sponsors | 1 tool call once scoped to `state` or `session_id` |
| Find legislator by name | Session discovery → session people lookup → manual matching | 1 tool call |

## Research Tips

- State codes are validated as two-letter strings and uppercased automatically (`ca` → `CA`). Invalid codes like `ZZ` pass local validation but return an API error from LegiScan.
- Always pin state and session in your prompt to reduce ambiguous results.
- Ask the agent to show `bill_id`, `roll_call_id`, and `people_id` in intermediate output so you can audit traceability.
- For legislator search, provide at least a first and last name (name input must be at least 2 characters).
- `legiscan_get_primary_authored` requires `state` or `session_id` so results stay scoped to the intended legislature and timeframe.
- `legiscan_get_legislator_votes` accepts up to 100 `bill_ids` per request; split larger jobs into chunks.
- `legiscan_search` retries compact bill-number queries like `AB858` using a canonical spaced format. For exact bill resolution, prefer `legiscan_find_bill_by_number`.
- Ask for final outputs in a table/CSV-ready shape if you plan downstream analysis.

## Development

```bash
npm run build        # Compile TypeScript
npm run typecheck    # Type-check src + tests
npm test             # Run deterministic unit tests (no API key)
npm run test:e2e     # Run real-world workflow tests (skips cleanly without API key)
npm run test:live    # Run live API integration tests (requires API key)
npm run test:coverage # Run unit tests with coverage
npm run lint         # Check for lint errors
npm run format       # Format code with Prettier
```

## Testing Modes

- `npm test` / `npm run test:unit`: Fast deterministic tests with mocked network calls.
- `npm run test:e2e`: Research workflow tests based on real legislative analysis tasks. Skips if `LEGISCAN_API_KEY` is unavailable.
- `npm run test:live`: Real LegiScan API integration tests. Requires `LEGISCAN_API_KEY`.

## API Limits

- Free public API keys have a **30,000 queries per month** limit
- Composite tools batch requests (10 concurrent max) and cache repeated lookups inside a single request to avoid unnecessary duplication
- Composite tools reduce MCP workflow friction, but LegiScan API usage still scales with the number of distinct bills and roll calls you inspect

## Docker

Build the container image locally:

```bash
docker build -t legiscan-mcp .
```

Run it with your API key provided at runtime:

```bash
docker run --rm -i \
  -e LEGISCAN_API_KEY=your-api-key-here \
  legiscan-mcp
```

## Releases

Glama checks expect a GitHub release. After merging your next repo changes, create and publish a tag such as `v1.0.0` from GitHub or with:

```bash
git tag v1.0.0
git push origin v1.0.0
```

## License

MIT - see [LICENSE](LICENSE) for details.
