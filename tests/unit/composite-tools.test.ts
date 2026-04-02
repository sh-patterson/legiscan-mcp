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

describe("composite MCP tools", () => {
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

  it("requires state or session_id for legiscan_get_primary_authored", async () => {
    const sponsoredSpy = vi
      .spyOn(LegiScanClient.prototype, "getSponsoredList")
      .mockResolvedValue([]);

    client = await createConnectedClient();
    const result = await client.callTool({
      name: "legiscan_get_primary_authored",
      arguments: { people_id: 21719 },
    });

    expect(result.isError).toBe(true);
    expect(getTextContent(result)).toContain("Provide state or session_id");
    expect(sponsoredSpy).not.toHaveBeenCalled();
  });

  it("deduplicates repeated bill and roll-call lookups within legiscan_get_legislator_votes", async () => {
    const getBillSpy = vi.spyOn(LegiScanClient.prototype, "getBill").mockResolvedValue({
      bill_id: 101,
      bill_number: "AB 101",
      title: "Transparency bill",
      votes: [{ roll_call_id: 555, chamber: "A" }],
      sponsors: [{ people_id: 21719, name: "Alex Lee" }],
    } as never);
    const getRollCallSpy = vi
      .spyOn(LegiScanClient.prototype, "getRollCall")
      .mockResolvedValue({
        roll_call_id: 555,
        date: "2026-01-01",
        desc: "Assembly Floor Vote",
        chamber: "A",
        passed: 1,
        votes: [{ people_id: 21719, vote_text: "Yea", vote_id: 1 }],
      } as never);

    client = await createConnectedClient();
    const result = await client.callTool({
      name: "legiscan_get_legislator_votes",
      arguments: { people_id: 21719, bill_ids: [101, 101] },
    });

    expect(result.isError).toBeFalsy();
    expect(getBillSpy).toHaveBeenCalledTimes(1);
    expect(getRollCallSpy).toHaveBeenCalledTimes(1);

    const payload = parseToolJson(result);
    expect(payload.legislator).toEqual({
      people_id: 21719,
      name: "Alex Lee",
    });
    expect(payload.votes).toHaveLength(2);
    expect(payload.summary).toEqual({
      total_votes: 2,
      yea: 2,
      nay: 0,
      nv: 0,
      absent: 0,
    });
  });
});
