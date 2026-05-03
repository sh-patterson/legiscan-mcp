import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

import { LegiScanClient } from "../../src/legiscan-client.js";
import { createServer } from "../../src/server.js";

function createLinkedTransportPair(): [Transport, Transport] {
  let onMessageA: Transport["onmessage"];
  let onMessageB: Transport["onmessage"];

  const transportA: Transport = {
    async start() {},
    async send(message: JSONRPCMessage) {
      onMessageB?.(message);
    },
    async close() {
      transportA.onclose?.();
    },
    set onmessage(handler) {
      onMessageA = handler;
    },
    get onmessage() {
      return onMessageA;
    },
  };

  const transportB: Transport = {
    async start() {},
    async send(message: JSONRPCMessage) {
      onMessageA?.(message);
    },
    async close() {
      transportB.onclose?.();
    },
    set onmessage(handler) {
      onMessageB = handler;
    },
    get onmessage() {
      return onMessageB;
    },
  };

  return [transportA, transportB];
}

async function createConnectedClient(): Promise<Client> {
  const server = createServer("fake-api-key-for-testing");
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = createLinkedTransportPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return client;
}

function getTextContent(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> })
    .content;
  if (!Array.isArray(content)) {
    throw new Error("Expected tool result content");
  }

  const textContent = content.find(
    (item): item is { type: string; text: string } => item.type === "text" && !!item.text
  );

  if (!textContent) {
    throw new Error("Expected text tool content");
  }

  return textContent.text;
}

function parseToolJson(result: unknown) {
  return JSON.parse(getTextContent(result));
}

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
