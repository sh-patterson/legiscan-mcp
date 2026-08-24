import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { LegiScanClient } from "../../src/legiscan-client.js";
import { createConnectedClient, parseToolJson } from "./mcp-test-helpers.js";

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

  it("supports unscoped legiscan_get_primary_authored calls", async () => {
    vi.spyOn(LegiScanClient.prototype, "getSponsoredList").mockResolvedValue([]);

    client = await createConnectedClient();
    const result = await client.callTool({
      name: "legiscan_get_primary_authored",
      arguments: { people_id: 21719 },
    });

    expect(result.isError).toBeFalsy();

    const payload = parseToolJson(result);
    expect(payload.scope).toEqual({ type: "all_sessions" });
    expect(payload.total_sponsored).toBe(0);
    expect(payload.primary_count).toBe(0);
    expect(payload.primary_authored).toEqual([]);
  });

  it("reports scoped sponsored totals consistently", async () => {
    vi.spyOn(LegiScanClient.prototype, "getSponsoredList").mockResolvedValue([
      { bill_id: 101, session_id: 2172 },
      { bill_id: 102, session_id: 2172 },
      { bill_id: 201, session_id: 2016 },
    ] as never);

    vi.spyOn(LegiScanClient.prototype, "getBill").mockImplementation(async (billId) => {
      if (billId === 101) {
        return {
          bill_id: 101,
          bill_number: "AB 101",
          title: "Current Session Bill",
          description: "Current session bill",
          session_id: 2172,
          status: 1,
          status_date: "2026-01-01",
          sponsors: [
            {
              people_id: 21719,
              name: "Alex Lee",
              sponsor_order: 1,
              sponsor_type_id: 1,
            },
          ],
        } as never;
      }

      return {
        bill_id: billId,
        bill_number: `AB ${billId}`,
        title: `Bill ${billId}`,
        description: `Bill ${billId}`,
        session_id: billId === 102 ? 2172 : 2016,
        status: 1,
        status_date: "2026-01-01",
        sponsors: [
          {
            people_id: 21719,
            name: "Alex Lee",
            sponsor_order: 2,
            sponsor_type_id: 2,
          },
        ],
      } as never;
    });

    client = await createConnectedClient();
    const result = await client.callTool({
      name: "legiscan_get_primary_authored",
      arguments: { people_id: 21719, session_id: 2172 },
    });

    expect(result.isError).toBeFalsy();

    const payload = parseToolJson(result);
    expect(payload.scope).toEqual({ type: "session", session_id: 2172 });
    expect(payload.total_sponsored).toBe(2);
    expect(payload.total_sponsored_all_sessions).toBe(3);
    expect(payload.primary_count).toBe(1);
    expect(payload.primary_authored).toHaveLength(1);
    expect(payload.primary_authored[0]).toMatchObject({
      bill_id: 101,
      bill_number: "AB 101",
      sponsor_order: 1,
    });
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
    expect(payload.votes).toHaveLength(1);
    expect(payload.summary).toEqual({
      total_votes: 1,
      yea: 1,
      nay: 0,
      nv: 0,
      absent: 0,
    });
  });

  it("does not count co-sponsors with sponsor_order 1 as primary authors", async () => {
    vi.spyOn(LegiScanClient.prototype, "getSponsoredList").mockResolvedValue([
      { bill_id: 101, session_id: 2172 },
    ] as never);

    vi.spyOn(LegiScanClient.prototype, "getBill").mockResolvedValue({
      bill_id: 101,
      bill_number: "AB 101",
      title: "Co-sponsored bill",
      description: "Co-sponsored bill",
      session_id: 2172,
      status: 1,
      status_date: "2026-01-01",
      sponsors: [
        {
          people_id: 21719,
          name: "Alex Lee",
          sponsor_order: 1,
          sponsor_type_id: 2,
        },
      ],
    } as never);

    client = await createConnectedClient();
    const result = await client.callTool({
      name: "legiscan_get_primary_authored",
      arguments: { people_id: 21719, session_id: 2172 },
    });

    expect(result.isError).toBeFalsy();

    const payload = parseToolJson(result);
    expect(payload.primary_count).toBe(0);
    expect(payload.primary_authored).toEqual([]);
  });

  it("caps roll calls per bill in legiscan_get_legislator_votes", async () => {
    vi.spyOn(LegiScanClient.prototype, "getBill").mockResolvedValue({
      bill_id: 101,
      bill_number: "AB 101",
      title: "Transparency bill",
      votes: [
        { roll_call_id: 1, chamber: "A", date: "2026-01-01" },
        { roll_call_id: 2, chamber: "A", date: "2026-02-01" },
        { roll_call_id: 3, chamber: "A", date: "2026-03-01" },
        { roll_call_id: 4, chamber: "A", date: "2026-04-01" },
        { roll_call_id: 5, chamber: "A", date: "2026-05-01" },
        { roll_call_id: 6, chamber: "A", date: "2026-06-01" },
      ],
      sponsors: [{ people_id: 21719, name: "Alex Lee" }],
    } as never);

    const getRollCallSpy = vi
      .spyOn(LegiScanClient.prototype, "getRollCall")
      .mockImplementation(async (rollCallId) =>
        ({
          roll_call_id: rollCallId,
          date: "2026-01-01",
          desc: "Assembly Floor Vote",
          chamber: "A",
          passed: 1,
          votes: [{ people_id: 21719, vote_text: "Yea", vote_id: 1 }],
        }) as never
      );

    client = await createConnectedClient();
    const result = await client.callTool({
      name: "legiscan_get_legislator_votes",
      arguments: { people_id: 21719, bill_ids: [101] },
    });

    expect(result.isError).toBeFalsy();
    expect(getRollCallSpy).toHaveBeenCalledTimes(5);

    const payload = parseToolJson(result);
    expect(payload.votes).toHaveLength(5);
    expect(payload.votes.map((v: { roll_call_id: number }) => v.roll_call_id)).toEqual([
      6, 5, 4, 3, 2,
    ]);
  });

  it("respects max_roll_calls_per_bill override in legiscan_get_legislator_votes", async () => {
    vi.spyOn(LegiScanClient.prototype, "getBill").mockResolvedValue({
      bill_id: 101,
      bill_number: "AB 101",
      title: "Transparency bill",
      votes: [
        { roll_call_id: 1, chamber: "A", date: "2026-01-01" },
        { roll_call_id: 2, chamber: "A", date: "2026-02-01" },
        { roll_call_id: 3, chamber: "A", date: "2026-03-01" },
      ],
      sponsors: [{ people_id: 21719, name: "Alex Lee" }],
    } as never);

    const getRollCallSpy = vi
      .spyOn(LegiScanClient.prototype, "getRollCall")
      .mockImplementation(async (rollCallId) =>
        ({
          roll_call_id: rollCallId,
          date: "2026-01-01",
          desc: "Assembly Floor Vote",
          chamber: "A",
          passed: 1,
          votes: [{ people_id: 21719, vote_text: "Yea", vote_id: 1 }],
        }) as never
      );

    client = await createConnectedClient();
    const result = await client.callTool({
      name: "legiscan_get_legislator_votes",
      arguments: {
        people_id: 21719,
        bill_ids: [101],
        max_roll_calls_per_bill: 2,
      },
    });

    expect(result.isError).toBeFalsy();
    expect(getRollCallSpy).toHaveBeenCalledTimes(2);

    const payload = parseToolJson(result);
    expect(payload.votes).toHaveLength(2);
  });

  it("truncates primary authored bill fetches when limit is exceeded", async () => {
    const sponsoredBills = Array.from({ length: 3 }, (_, i) => ({
      bill_id: 100 + i,
      session_id: 2172,
    }));
    vi.spyOn(LegiScanClient.prototype, "getSponsoredList").mockResolvedValue(
      sponsoredBills as never
    );

    const getBillSpy = vi
      .spyOn(LegiScanClient.prototype, "getBill")
      .mockImplementation(async (billId) =>
        ({
          bill_id: billId,
          bill_number: `AB ${billId}`,
          title: `Bill ${billId}`,
          description: `Bill ${billId}`,
          session_id: 2172,
          status: 1,
          status_date: "2026-01-01",
          sponsors: [
            {
              people_id: 21719,
              name: "Alex Lee",
              sponsor_order: 1,
              sponsor_type_id: 1,
            },
          ],
        }) as never
      );

    client = await createConnectedClient();
    const result = await client.callTool({
      name: "legiscan_get_primary_authored",
      arguments: { people_id: 21719, session_id: 2172, limit: 2 },
    });

    expect(result.isError).toBeFalsy();
    expect(getBillSpy).toHaveBeenCalledTimes(2);

    const payload = parseToolJson(result);
    expect(payload.limit).toBe(2);
    expect(payload.truncated).toBe(true);
    expect(payload.total_sponsored).toBe(3);
    expect(payload.primary_count).toBe(2);
  });
});
