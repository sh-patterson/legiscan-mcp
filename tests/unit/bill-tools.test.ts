import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { LegiScanClient } from "../../src/legiscan-client.js";
import {
  createConnectedClient,
  getTextContent,
  parseToolJson,
} from "./mcp-test-helpers.js";

describe("bill MCP tools", () => {
  let client: Client | undefined;

  beforeEach(() => {
    client = undefined;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (client) {
      await client.close();
    }
  });

  it("finds a bill by number in a state current session", async () => {
    const findBillSpy = vi
      .spyOn(LegiScanClient.prototype, "findBillByNumber")
      .mockResolvedValue({
        bill_id: 858,
        number: "AB 858",
        change_hash: "abc123",
        url: "https://example.com/ab858",
      } as never);

    client = await createConnectedClient();
    const result = await client.callTool({
      name: "legiscan_find_bill_by_number",
      arguments: { state: "ca", bill_number: "AB858" },
    });

    expect(result.isError).toBeFalsy();
    expect(findBillSpy).toHaveBeenCalledWith("CA", "AB858");
    expect(parseToolJson(result)).toMatchObject({
      bill_id: 858,
      number: "AB 858",
    });
  });

  it("finds a bill by number in a specific session", async () => {
    const findBillSpy = vi
      .spyOn(LegiScanClient.prototype, "findBillByNumberInSession")
      .mockResolvedValue({
        bill_id: 101,
        number: "SB 101",
        change_hash: "def456",
        url: "https://example.com/sb101",
      } as never);

    client = await createConnectedClient();
    const result = await client.callTool({
      name: "legiscan_find_bill_by_number",
      arguments: { session_id: 2172, state: "CA", bill_number: "SB101" },
    });

    expect(result.isError).toBeFalsy();
    expect(findBillSpy).toHaveBeenCalledWith(2172, "SB101");
    expect(parseToolJson(result)).toMatchObject({
      bill_id: 101,
      number: "SB 101",
    });
  });

  it("returns a structured not-found payload", async () => {
    vi.spyOn(LegiScanClient.prototype, "findBillByNumberInSession").mockResolvedValue(
      null
    );

    client = await createConnectedClient();
    const result = await client.callTool({
      name: "legiscan_find_bill_by_number",
      arguments: { session_id: 2172, bill_number: "AB9999" },
    });

    expect(result.isError).toBeFalsy();
    expect(parseToolJson(result)).toEqual({
      found: false,
      message: "Bill 'AB9999' not found in session 2172",
    });
  });

  it("returns an MCP error when neither state nor session_id is provided", async () => {
    client = await createConnectedClient();
    const result = await client.callTool({
      name: "legiscan_find_bill_by_number",
      arguments: { bill_number: "AB858" },
    });

    expect(result.isError).toBe(true);
    expect(getTextContent(result)).toBe("Error: Either session_id or state is required");
  });
});
