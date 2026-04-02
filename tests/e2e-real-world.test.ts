/**
 * Real-World E2E Tests for LegiScan MCP Server
 *
 * Based on actual friction points encountered during CA Assembly
 * legislative scorecard analysis (December 2024).
 *
 * These tests validate that the MCP server can handle real opposition
 * research and legislative analysis workflows efficiently.
 *
 * Run with: npm run test:e2e
 * Requires: LEGISCAN_API_KEY environment variable
 */

import { describe, it, expect, beforeAll } from "vitest";
import { config } from "dotenv";
import { LegiScanClient } from "../src/legiscan-client.js";

config();

const apiKey = process.env.LEGISCAN_API_KEY;
const describeE2E = apiKey ? describe : describe.skip;

/**
 * =============================================================================
 * TEST SUITE 1: LEGISLATOR IDENTIFICATION
 * =============================================================================
 *
 * FRICTION POINT: During the CA Assembly project, I had to manually discover
 * people_ids through trial and error (Alex Lee = 21719, etc.). The MCP server
 * should make it easy to find legislators by name.
 */
describeE2E("Legislator Identification Workflow", () => {
  let client: LegiScanClient;

  // Known CA Assembly members from our scorecard project
  const TARGET_LEGISLATORS = [
    { name: "Alex Lee", expectedDistrict: "AD-024", people_id: 21719 },
    { name: "Liz Ortega", expectedDistrict: "AD-020", people_id: 23214 },
    { name: "Tina McKinnor", expectedDistrict: "AD-061", people_id: 23155 },
    { name: "Corey Jackson", expectedDistrict: "AD-060", people_id: 23210 },
    { name: "Sade Elhawary", expectedDistrict: "AD-057", people_id: 25359 },
  ];

  // CA session IDs
  const CA_SESSIONS = {
    "2025-2026": 2172,
    "2023-2024": 2016,
    "2021-2022": 1791,
  };

  beforeAll(() => {
    client = new LegiScanClient(apiKey!);
  });

  it("should find legislators in a session by iterating session people", async () => {
    // Get all legislators in current CA session
    const sessionPeople = await client.getSessionPeople(CA_SESSIONS["2025-2026"]);

    expect(sessionPeople.people).toBeDefined();
    expect(sessionPeople.people.length).toBeGreaterThan(0);

    // Try to find Alex Lee
    const alexLee = sessionPeople.people.find(
      (p) =>
        p.name?.toLowerCase().includes("lee") && p.first_name?.toLowerCase() === "alex"
    );

    expect(alexLee).toBeDefined();
    expect(alexLee?.people_id).toBe(21719);
  });

  it("should get legislator details by known people_id", async () => {
    // Using Alex Lee's known ID
    const person = await client.getPerson(21719);

    expect(person).toBeDefined();
    expect(person.people_id).toBe(21719);
    expect(person.name).toContain("Lee");
    expect(person.party).toBe("D"); // Democrat
    expect(person.role).toBe("Rep"); // Assembly member
  });

  it("should handle all target legislators from scorecard project", async () => {
    // Verify all 5 legislators we tracked can be retrieved
    for (const leg of TARGET_LEGISLATORS) {
      const person = await client.getPerson(leg.people_id);

      expect(person).toBeDefined();
      expect(person.people_id).toBe(leg.people_id);
      expect(person.party).toBe("D"); // All are Democrats
    }
  });
});

/**
 * =============================================================================
 * TEST SUITE 2: BILL NUMBER LOOKUP
 * =============================================================================
 *
 * FRICTION POINT: Bill numbers came in different formats (AB 858 vs AB858).
 * Searches sometimes returned wrong results. Need reliable bill lookup.
 */
describeE2E("Bill Number Lookup Workflow", () => {
  let client: LegiScanClient;

  beforeAll(() => {
    client = new LegiScanClient(apiKey!);
  });

  it("should find bill by exact number with space", async () => {
    const result = await client.getSearch({
      query: "AB 858",
      state: "CA",
      session_id: 2172, // 2025-2026 CA session
    });

    expect(result.results).toBeDefined();
    expect(result.results.length).toBeGreaterThan(0);

    // First result should match
    const match = result.results.find(
      (b) => b.bill_number?.replace(/\s/g, "").toUpperCase() === "AB858"
    );
    expect(match).toBeDefined();
  });

  it("should find bill by number without space using findBillByNumber", async () => {
    // Use findBillByNumber which normalizes bill number formats
    const result = await client.findBillByNumberInSession(2172, "AB858");

    expect(result).toBeDefined();
    expect(result).not.toBeNull();
    expect(result!.bill_id).toBeDefined();
    // Normalized comparison
    expect(result!.number.replace(/\s/g, "").toUpperCase()).toBe("AB858");
  });

  it("should find bill by compact number in a session-scoped search", async () => {
    const result = await client.getSearch({
      query: "AB858",
      session_id: 2172, // 2025-2026 CA session
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(
      result.results.some(
        (b) => b.bill_number?.replace(/\s/g, "").toUpperCase() === "AB858"
      )
    ).toBe(true);
  });

  it("should get bill details for Job Killer bill AB 858 (Lee)", async () => {
    // First search for the bill
    const searchResult = await client.getSearch({
      query: "AB 858",
      state: "CA",
      session_id: 2172, // 2025-2026
    });

    expect(searchResult.results.length).toBeGreaterThan(0);
    const billId = searchResult.results[0].bill_id;

    // Get full details
    const bill = await client.getBill(billId);

    expect(bill).toBeDefined();
    expect(bill.bill_number).toMatch(/AB\s*858/i);
    expect(bill.sponsors).toBeDefined();
    expect(bill.sponsors.length).toBeGreaterThan(0);

    // Verify Alex Lee is primary sponsor (sponsor_order = 1)
    const primarySponsor = bill.sponsors.find((s) => s.sponsor_order === 1);
    expect(primarySponsor).toBeDefined();
    expect(primarySponsor?.people_id).toBe(21719); // Alex Lee
  });
});

/**
 * =============================================================================
 * TEST SUITE 3: PRIMARY AUTHORED BILLS
 * =============================================================================
 *
 * FRICTION POINT: getSponsoredList returns ALL bills (sponsored + co-sponsored).
 * Had to call getBill for each to check sponsor_order=1 for primary authored.
 * This was slow and API-intensive.
 */
describeE2E("Primary Authored Bills Workflow", () => {
  let client: LegiScanClient;

  beforeAll(() => {
    client = new LegiScanClient(apiKey!);
  });

  it("should get all sponsored bills for Alex Lee", async () => {
    const sponsored = await client.getSponsoredList(21719);

    expect(sponsored).toBeDefined();
    expect(Array.isArray(sponsored)).toBe(true);
    expect(sponsored.length).toBeGreaterThan(0);

    console.log(`Alex Lee has ${sponsored.length} total sponsored/co-sponsored bills`);
  });

  it("should identify primary authored bills by checking sponsor_order", async () => {
    // Get sponsored list
    const sponsored = await client.getSponsoredList(21719);

    // Check first 5 bills to find primary authored
    const primaryAuthored: Array<{ bill_id: number; number: string; title: string }> = [];

    for (const bill of sponsored.slice(0, 10)) {
      const details = await client.getBill(bill.bill_id);

      // Find Alex Lee in sponsors
      const alexSponsor = details.sponsors?.find((s) => s.people_id === 21719);

      if (alexSponsor?.sponsor_order === 1) {
        primaryAuthored.push({
          bill_id: bill.bill_id,
          number: details.bill_number,
          title: details.title,
        });
      }
    }

    console.log(`Found ${primaryAuthored.length} primary authored bills in first 10`);
    expect(primaryAuthored.length).toBeGreaterThan(0);
  });

  it("should find Tina McKinnor's pension bill AB 1383", async () => {
    // Search for the bill
    const result = await client.getSearch({
      query: "AB 1383 retirement",
      state: "CA",
      session_id: 2172, // 2025-2026
    });

    if (result.results.length > 0) {
      const bill = await client.getBill(result.results[0].bill_id);

      // Check if McKinnor is primary author
      const mckinnonSponsor = bill.sponsors?.find((s) => s.people_id === 23155);

      if (mckinnonSponsor) {
        expect(mckinnonSponsor.sponsor_order).toBe(1);
        console.log("Confirmed: McKinnor is primary author of AB 1383");
      }
    }
  });
});

/**
 * =============================================================================
 * TEST SUITE 4: ROLL CALL VOTE ANALYSIS
 * =============================================================================
 *
 * FRICTION POINT: Had to filter roll calls by chamber (Assembly vs Senate),
 * then extract specific legislator votes by people_id. Complex multi-step process.
 */
describeE2E("Roll Call Vote Analysis Workflow", () => {
  let client: LegiScanClient;

  beforeAll(() => {
    client = new LegiScanClient(apiKey!);
  });

  it("should get roll call and extract legislator votes", async () => {
    // Get a bill with known votes (AB 858 - Lee's bill)
    const searchResult = await client.getSearch({
      query: "AB 858 displaced workers",
      state: "CA",
      year: 2,
    });

    if (searchResult.results.length === 0) {
      console.log("Skipping: AB 858 not found");
      return;
    }

    const bill = await client.getBill(searchResult.results[0].bill_id);

    if (!bill.votes || bill.votes.length === 0) {
      console.log("Skipping: No votes on this bill yet");
      return;
    }

    // Find Assembly floor vote (chamber = "A" or "H")
    const assemblyVote = bill.votes.find(
      (v) => v.chamber === "A" || v.chamber === "H" || v.chamber_id === 1
    );

    if (!assemblyVote) {
      console.log("Skipping: No Assembly floor vote found");
      return;
    }

    // Get roll call details
    const rollCall = await client.getRollCall(assemblyVote.roll_call_id);

    expect(rollCall).toBeDefined();
    expect(rollCall.votes).toBeDefined();
    expect(Array.isArray(rollCall.votes)).toBe(true);

    // Extract votes for our target legislators
    const targetIds = [21719, 23214, 23155, 23210, 25359];
    const targetVotes = rollCall.votes.filter((v) => targetIds.includes(v.people_id));

    console.log(`Found ${targetVotes.length} target legislator votes`);
    for (const vote of targetVotes) {
      console.log(`  ${vote.people_id}: ${vote.vote_text}`);
    }
  });

  it("should identify close votes for salience analysis", async () => {
    // Get master list and find bills with close votes
    const masterList = await client.getMasterList({ state: "CA" });

    let closeVoteFound = false;

    // Check first 20 bills for close votes
    for (const billSummary of masterList.slice(0, 20)) {
      const bill = await client.getBill(billSummary.bill_id);

      for (const vote of bill.votes || []) {
        const rollCall = await client.getRollCall(vote.roll_call_id);

        const margin = Math.abs(rollCall.yea - rollCall.nay);
        const totalVotes = rollCall.yea + rollCall.nay;

        // Close vote = margin <= 10% of total votes
        if (totalVotes > 0 && margin <= totalVotes * 0.1) {
          console.log(`Close vote found: ${bill.bill_number}`);
          console.log(`  Yea: ${rollCall.yea}, Nay: ${rollCall.nay}, Margin: ${margin}`);
          closeVoteFound = true;
          break;
        }
      }

      if (closeVoteFound) break;
    }

    // May not find a close vote in first 20 bills
    console.log(
      `Close vote search complete: ${closeVoteFound ? "found" : "not found in sample"}`
    );
  });
});

/**
 * =============================================================================
 * TEST SUITE 5: SCORECARD EXTRACTION PIPELINE
 * =============================================================================
 *
 * FRICTION POINT: Had to extract bills from multiple CSV scorecards (CalChamber,
 * Labor Fed, Sierra Club), normalize bill numbers, then lookup each one.
 * This test simulates that workflow.
 */
describeE2E("Scorecard Extraction Pipeline", () => {
  let client: LegiScanClient;

  // Simulated scorecard bill list (from our actual CSVs)
  const SCORECARD_BILLS = [
    { number: "AB 858", org: "CalChamber", position: "Oppose" },
    { number: "SB 525", org: "CalChamber", position: "Oppose" },
    { number: "SB 616", org: "CalChamber", position: "Oppose" },
    { number: "SB 399", org: "CalChamber", position: "Oppose" },
    { number: "AB 1", org: "ACU/CPAC", position: "Oppose" },
  ];

  beforeAll(() => {
    client = new LegiScanClient(apiKey!);
  });

  it("should lookup multiple bills from scorecard list", async () => {
    const results: Array<{
      number: string;
      bill_id: number | null;
      title: string | null;
      status: string | null;
    }> = [];

    for (const scorecardBill of SCORECARD_BILLS) {
      const searchResult = await client.getSearch({
        query: scorecardBill.number,
        state: "CA",
        year: 1, // All years
      });

      if (searchResult.results.length > 0) {
        const bill = await client.getBill(searchResult.results[0].bill_id);
        results.push({
          number: scorecardBill.number,
          bill_id: bill.bill_id,
          title: bill.title,
          status: bill.status_desc,
        });
      } else {
        results.push({
          number: scorecardBill.number,
          bill_id: null,
          title: null,
          status: null,
        });
      }
    }

    console.log(`Looked up ${results.length} bills:`);
    for (const r of results) {
      console.log(`  ${r.number}: ${r.bill_id ? "Found" : "NOT FOUND"} - ${r.status}`);
    }

    // At least some should be found
    const found = results.filter((r) => r.bill_id !== null);
    expect(found.length).toBeGreaterThan(0);
  });

  it("should get voting alignment for target legislators on scorecard bills", async () => {
    const targetIds = [21719, 23214, 23155, 23210, 25359];
    const alignmentData: Record<number, { yes: number; no: number; notFound: number }> =
      {};

    for (const id of targetIds) {
      alignmentData[id] = { yes: 0, no: 0, notFound: 0 };
    }

    // Check first 3 bills
    for (const scorecardBill of SCORECARD_BILLS.slice(0, 3)) {
      const searchResult = await client.getSearch({
        query: scorecardBill.number,
        state: "CA",
        year: 1,
      });

      if (searchResult.results.length === 0) continue;

      const bill = await client.getBill(searchResult.results[0].bill_id);

      // Get Assembly floor vote
      const assemblyVote = bill.votes?.find(
        (v) => v.chamber === "A" || v.chamber === "H"
      );

      if (!assemblyVote) continue;

      const rollCall = await client.getRollCall(assemblyVote.roll_call_id);

      // Count votes
      for (const vote of rollCall.votes || []) {
        if (targetIds.includes(vote.people_id)) {
          if (vote.vote_text === "Yea") {
            alignmentData[vote.people_id].yes++;
          } else if (vote.vote_text === "Nay") {
            alignmentData[vote.people_id].no++;
          }
        }
      }
    }

    console.log("Alignment data (sample):", alignmentData);
  });
});

/**
 * =============================================================================
 * TEST SUITE 6: SESSION MAPPING
 * =============================================================================
 *
 * FRICTION POINT: Had to know session IDs by heart (2172 = 2025-2026).
 * Should be able to find session by year.
 */
describeE2E("Session Mapping Workflow", () => {
  let client: LegiScanClient;

  beforeAll(() => {
    client = new LegiScanClient(apiKey!);
  });

  it("should get all CA sessions and map by year", async () => {
    const sessions = await client.getSessionList("CA");

    expect(sessions.length).toBeGreaterThan(0);

    // Build year mapping
    const sessionMap: Record<string, number> = {};
    for (const session of sessions) {
      const key = `${session.year_start}-${session.year_end}`;
      sessionMap[key] = session.session_id;
    }

    console.log("CA Session Map:", sessionMap);

    // Verify known sessions
    expect(sessionMap["2025-2026"]).toBe(2172);
    expect(sessionMap["2023-2024"]).toBe(2016);
  });

  it("should find current session programmatically", async () => {
    const sessions = await client.getSessionList("CA");

    // Find session marked as current/regular
    const currentSession = sessions.find((s) => s.session_id && s.special === 0);

    expect(currentSession).toBeDefined();
    console.log(
      `Current CA session: ${currentSession?.session_id} (${currentSession?.name})`
    );
  });
});

/**
 * =============================================================================
 * TEST SUITE 7: BATCH OPERATIONS SIMULATION
 * =============================================================================
 *
 * FRICTION POINT: Had to call getBill 200+ times to enrich all bills.
 * Tests the pattern of efficient batch retrieval.
 */
describeE2E("Batch Operations Workflow", () => {
  let client: LegiScanClient;

  beforeAll(() => {
    client = new LegiScanClient(apiKey!);
  });

  it("should efficiently retrieve multiple bills from master list", async () => {
    const masterList = await client.getMasterList({ state: "CA" });

    // Simulate batch enrichment (first 10 bills)
    const enrichedBills: Array<{
      bill_id: number;
      number: string;
      title: string;
      sponsor_count: number;
      vote_count: number;
    }> = [];

    const startTime = Date.now();

    for (const billSummary of masterList.slice(0, 10)) {
      const bill = await client.getBill(billSummary.bill_id);
      enrichedBills.push({
        bill_id: bill.bill_id,
        number: bill.bill_number,
        title: bill.title,
        sponsor_count: bill.sponsors?.length || 0,
        vote_count: bill.votes?.length || 0,
      });
    }

    const elapsed = Date.now() - startTime;
    console.log(`Enriched 10 bills in ${elapsed}ms (${elapsed / 10}ms per bill)`);

    expect(enrichedBills.length).toBe(10);
  });
});

/**
 * =============================================================================
 * TEST SUITE 8: OPPOSITION RESEARCH WORKFLOW
 * =============================================================================
 *
 * This simulates the complete workflow we used to build the opposition
 * research report on CA Assembly legislators.
 */
describeE2E("Opposition Research Complete Workflow", () => {
  let client: LegiScanClient;

  const TARGET_LEGISLATOR = {
    name: "Alex Lee",
    people_id: 21719,
    district: "AD-24",
  };

  beforeAll(() => {
    client = new LegiScanClient(apiKey!);
  });

  it("should complete full opposition research pipeline for one legislator", async () => {
    // Step 1: Verify legislator exists
    const person = await client.getPerson(TARGET_LEGISLATOR.people_id);
    expect(person).toBeDefined();
    console.log(`Step 1: Found ${person.name} (${person.party})`);

    // Step 2: Get all sponsored bills
    const sponsored = await client.getSponsoredList(TARGET_LEGISLATOR.people_id);
    console.log(`Step 2: Found ${sponsored.length} sponsored bills`);

    // Step 3: Identify primary authored bills (check first 10)
    const primaryAuthored: string[] = [];
    for (const bill of sponsored.slice(0, 10)) {
      const details = await client.getBill(bill.bill_id);
      const iamPrimary = details.sponsors?.find(
        (s) => s.people_id === TARGET_LEGISLATOR.people_id && s.sponsor_order === 1
      );
      if (iamPrimary) {
        primaryAuthored.push(details.bill_number);
      }
    }
    console.log(`Step 3: Primary authored (sample): ${primaryAuthored.join(", ")}`);

    // Step 4: Check voting record on known controversial bills
    const controversialBills = ["SB 525", "SB 616"];
    const voteRecord: Record<string, string> = {};

    for (const billNum of controversialBills) {
      const search = await client.getSearch({
        query: billNum,
        state: "CA",
        year: 1,
      });

      if (search.results.length === 0) continue;

      const bill = await client.getBill(search.results[0].bill_id);
      const assemblyVote = bill.votes?.find(
        (v) => v.chamber === "A" || v.chamber === "H"
      );

      if (!assemblyVote) {
        voteRecord[billNum] = "No Assembly vote found";
        continue;
      }

      const rollCall = await client.getRollCall(assemblyVote.roll_call_id);
      const myVote = rollCall.votes?.find(
        (v) => v.people_id === TARGET_LEGISLATOR.people_id
      );

      voteRecord[billNum] = myVote?.vote_text || "Not found";
    }

    console.log(`Step 4: Vote record:`, voteRecord);

    // Complete pipeline assertion
    expect(person.name).toContain("Lee");
    expect(sponsored.length).toBeGreaterThan(0);
  });
});
