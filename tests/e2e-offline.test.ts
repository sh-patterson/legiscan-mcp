import { afterEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { createConnectedClient, parseToolJson } from "./unit/mcp-test-helpers.js";

function stubLegiScan(
  respond: (operation: string, id: number) => Record<string, unknown>
) {
  const requests: Array<{ operation: string; id: number }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://api.legiscan.com");
      expect(url.searchParams.get("key")).toBe("offline-test-key");
      const operation = url.searchParams.get("op") ?? "";
      const id = Number(url.searchParams.get("id"));
      requests.push({ operation, id });
      return new Response(JSON.stringify({ status: "OK", ...respond(operation, id) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    })
  );
  return requests;
}

describe("MCP-to-LegiScan workflow with simulated HTTP", () => {
  let client: Client | undefined;

  afterEach(async () => {
    if (client) await client.close();
    client = undefined;
    vi.unstubAllGlobals();
  });

  it("continues past a vote-free first page to an older legislator vote", async () => {
    const requests = stubLegiScan((operation, id) => {
      if (operation === "getBill" && id === 101) {
        return {
          bill: {
            bill_id: 101,
            bill_number: "AB 101",
            title: "Test bill",
            votes: [
              { roll_call_id: 1, chamber: "A", date: "2026-01-01" },
              { roll_call_id: 2, chamber: "A", date: "2026-02-01" },
              { roll_call_id: 3, chamber: "A", date: "2026-03-01" },
            ],
            sponsors: [],
          },
        };
      }
      if (operation === "getRollCall") {
        return {
          roll_call: {
            roll_call_id: id,
            date: "2026-01-01",
            desc: "Assembly vote",
            chamber: "A",
            passed: 1,
            votes: id === 1 ? [{ people_id: 7, vote_text: "Yea", vote_id: 1 }] : [],
          },
        };
      }
      throw new Error(`Unexpected LegiScan request: ${operation} ${id}`);
    });
    client = await createConnectedClient("offline-test-key");

    const first = parseToolJson(
      await client.callTool({
        name: "legiscan_get_legislator_votes",
        arguments: { people_id: 7, bill_ids: [101], max_roll_calls_per_bill: 2 },
      })
    );
    expect(first.votes).toEqual([]);
    expect(first.roll_call_coverage[0]).toMatchObject({
      available: 3,
      selected: 2,
      next_offset: 2,
    });

    const second = parseToolJson(
      await client.callTool({
        name: "legiscan_get_legislator_votes",
        arguments: {
          people_id: 7,
          bill_ids: [101],
          max_roll_calls_per_bill: 2,
          roll_call_offset: first.roll_call_coverage[0].next_offset,
        },
      })
    );
    expect(
      second.votes.map((vote: { roll_call_id: number }) => vote.roll_call_id)
    ).toEqual([1]);
    expect(second.roll_call_coverage[0].next_offset).toBeUndefined();
    expect(requests).toEqual([
      { operation: "getBill", id: 101 },
      { operation: "getRollCall", id: 3 },
      { operation: "getRollCall", id: 2 },
      { operation: "getBill", id: 101 },
      { operation: "getRollCall", id: 1 },
    ]);
  });

  it("continues authored-bill lookup to a later sponsored-list page", async () => {
    const requests = stubLegiScan((operation, id) => {
      if (operation === "getSponsoredList" && id === 7) {
        return {
          sponsoredbills: {
            bills: [101, 102, 103].map((bill_id) => ({ bill_id, session_id: 2172 })),
          },
        };
      }
      if (operation === "getBill") {
        return {
          bill: {
            bill_id: id,
            bill_number: `AB ${id}`,
            title: `Bill ${id}`,
            description: `Bill ${id}`,
            session_id: 2172,
            status: 1,
            status_date: "2026-01-01",
            sponsors: [
              {
                people_id: 7,
                name: "Test Legislator",
                sponsor_order: 1,
                sponsor_type_id: id === 103 ? 1 : 2,
              },
            ],
          },
        };
      }
      throw new Error(`Unexpected LegiScan request: ${operation} ${id}`);
    });
    client = await createConnectedClient("offline-test-key");

    const first = parseToolJson(
      await client.callTool({
        name: "legiscan_get_primary_authored",
        arguments: { people_id: 7, session_id: 2172, limit: 2 },
      })
    );
    expect(first.primary_authored).toEqual([]);
    expect(first.next_offset).toBe(2);

    const second = parseToolJson(
      await client.callTool({
        name: "legiscan_get_primary_authored",
        arguments: {
          people_id: 7,
          session_id: 2172,
          limit: 2,
          offset: first.next_offset,
        },
      })
    );
    expect(
      second.primary_authored.map((bill: { bill_id: number }) => bill.bill_id)
    ).toEqual([103]);
    expect(second.next_offset).toBeUndefined();
    expect(requests).toEqual([
      { operation: "getSponsoredList", id: 7 },
      { operation: "getBill", id: 101 },
      { operation: "getBill", id: 102 },
      { operation: "getSponsoredList", id: 7 },
      { operation: "getBill", id: 103 },
    ]);
  });
});
