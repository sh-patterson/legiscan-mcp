# LegiScan MCP Server

[![CI](https://github.com/sh-patterson/legiscan-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/sh-patterson/legiscan-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)

A Model Context Protocol (MCP) server that provides access to the [LegiScan API](https://legiscan.com/) for legislative data from all 50 US states and Congress.

## Features

- **10 Streamlined MCP Tools** optimized for legislative research workflows
- **Composite tools** that batch multiple API calls (90%+ reduction in API usage)
- Full TypeScript type definitions for all API responses
- Bill number normalization (handles AB 858, AB858, AB-858 formats)

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

### 2. Add to Claude Desktop

Add to your Claude Desktop configuration:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

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
| `legiscan_find_bill_by_number` | Find bill by number (handles AB 858, AB858, AB-858) |
| `legiscan_get_roll_call` | Get vote details with individual legislator votes |

### People
| Tool | Description |
|------|-------------|
| `legiscan_get_person` | Get legislator info with third-party IDs (VoteSmart, OpenSecrets, etc.) |
| `legiscan_get_session_people` | Get all legislators active in a session |

### Search
| Tool | Description |
|------|-------------|
| `legiscan_search` | Full-text search across legislation |

### Sessions
| Tool | Description |
|------|-------------|
| `legiscan_get_session_list` | List available legislative sessions by state |

## Usage Examples

### Find a legislator and get their voting record
```
1. Use legiscan_find_legislator with name="Smith" state="TX"
2. Use legiscan_get_legislator_votes with people_id and bill_ids
```

### Get all primary authored bills for a legislator
```
Use legiscan_get_primary_authored with people_id=12345 state="TX"
```

### Find a specific bill by number
```
Use legiscan_find_bill_by_number with state="CA" bill_number="AB 858"
```

### Search for bills about a topic
```
Use legiscan_search with query="climate change" state="CA"
```

### Get detailed information about a specific bill
```
Use legiscan_get_bill with bill_id=1234567
```

## API Call Reduction

The composite tools dramatically reduce API calls for common workflows:

| Workflow | Without Composites | With Composites |
|----------|-------------------|-----------------|
| Get votes for 1 legislator on 10 bills | ~80 calls | 1 call |
| Filter primary authored from 150 sponsored | ~150 calls | 1 call |
| Find legislator by name | 2 calls | 1 call |

## Development

```bash
npm run build        # Compile TypeScript
npm test             # Run unit tests
npm run test:e2e     # Run E2E tests (requires API key)
npm run lint         # Check for lint errors
npm run format       # Format code with Prettier
```

## API Limits

- Free public API keys have a **30,000 queries per month** limit
- Composite tools batch requests (10 concurrent max) to avoid rate limits
- The composite tools help you stay within limits by reducing total API calls

## License

MIT - see [LICENSE](LICENSE) for details.
