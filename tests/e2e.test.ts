/**
 * E2E Test Suite for LegiScan MCP Server
 *
 * Tests the full legislative data workflow:
 * 1. Session discovery
 * 2. Bill search
 * 3. Bill enrichment
 * 4. Text retrieval
 * 5. Roll call vote analysis
 * 6. Legislator lookup
 *
 * Run with: npm run test:e2e
 * Requires: LEGISCAN_API_KEY environment variable
 */

import { describe, it, expect, beforeAll } from "vitest";
import { config } from "dotenv";
import { LegiScanClient } from "../src/legiscan-client.js";

// Load .env file
config();

// Test configuration
const TEST_STATE = "CA";
const TEST_QUERY = "education";

// Skip entire suite if no API key
const apiKey = process.env.LEGISCAN_API_KEY;
const describeE2E = apiKey ? describe : describe.skip;

describeE2E("LegiScan MCP E2E Tests", () => {
  let client: LegiScanClient;

  // Cached IDs from sequential tests
  let sessionId: number | undefined;
  let billId: number | undefined;
  let docId: number | undefined;
  let rollCallId: number | undefined;
  let peopleId: number | undefined;

  beforeAll(() => {
    client = new LegiScanClient(apiKey!);
  });

  describe("Session Discovery", () => {
    it("should get session list for a state", async () => {
      const sessions = await client.getSessionList(TEST_STATE);

      expect(sessions).toBeDefined();
      expect(Array.isArray(sessions)).toBe(true);
      expect(sessions.length).toBeGreaterThan(0);

      const first = sessions[0];
      expect(first.session_id).toBeDefined();
      expect(first.state_id).toBeDefined();

      // Cache for subsequent tests
      sessionId = first.session_id;
    });
  });

  describe("Bill Search (Stage 2 equivalent)", () => {
    it("should search bills by keyword", async () => {
      const result = await client.getSearch({
        query: TEST_QUERY,
        state: TEST_STATE,
        year: 2, // Current session
      });

      expect(result).toBeDefined();
      expect(result.summary).toBeDefined();
      expect(result.summary.count).toBeGreaterThan(0);

      // Results are already extracted as array by client
      expect(result.results).toBeDefined();
      expect(result.results.length).toBeGreaterThan(0);
      billId = result.results[0].bill_id;
    });

    it("should search with raw mode for bulk operations", async () => {
      const result = await client.getSearchRaw({
        query: TEST_QUERY,
        state: TEST_STATE,
        year: 2,
      });

      expect(result).toBeDefined();
      expect(result.summary).toBeDefined();
      expect(result.results).toBeDefined();
    });
  });

  describe("Bill Enrichment (Stage 3 equivalent)", () => {
    it("should get bill details", async () => {
      expect(billId).toBeDefined();

      const bill = await client.getBill(billId!);

      expect(bill).toBeDefined();
      expect(bill.bill_id).toBe(billId);
      expect(bill.bill_number).toBeDefined();
      expect(bill.title).toBeDefined();

      // Cache IDs for subsequent tests
      if (bill.texts && bill.texts.length > 0) {
        docId = bill.texts[0].doc_id;
      }
      if (bill.votes && bill.votes.length > 0) {
        rollCallId = bill.votes[0].roll_call_id;
      }
      if (bill.sponsors && bill.sponsors.length > 0) {
        peopleId = bill.sponsors[0].people_id;
      }
    });

    it("should get bill text for summarization", async () => {
      if (!docId) {
        console.log("Skipping: no doc_id available");
        return;
      }

      const text = await client.getBillText(docId);

      expect(text).toBeDefined();
      expect(text.doc_id).toBe(docId);
      expect(text.doc).toBeDefined();
      expect(text.mime).toBeDefined();
    });
  });

  describe("Vote Analysis (Stage 4 salience equivalent)", () => {
    it("should get roll call vote details", async () => {
      if (!rollCallId) {
        console.log("Skipping: no roll_call_id available");
        return;
      }

      const rollCall = await client.getRollCall(rollCallId);

      expect(rollCall).toBeDefined();
      expect(rollCall.roll_call_id).toBe(rollCallId);
      expect(typeof rollCall.yea).toBe("number");
      expect(typeof rollCall.nay).toBe("number");

      // Salience calculation: close vote margin
      const margin = Math.abs(rollCall.yea - rollCall.nay);
      const isCloseVote = margin <= 5;
      console.log(`Vote margin: ${margin} (close vote: ${isCloseVote})`);

      // Individual votes for party break analysis
      if (rollCall.votes) {
        expect(Array.isArray(rollCall.votes)).toBe(true);
      }
    });
  });

  describe("Legislator Lookup (Party break detection)", () => {
    it("should get legislator info", async () => {
      if (!peopleId) {
        console.log("Skipping: no people_id available");
        return;
      }

      const person = await client.getPerson(peopleId);

      expect(person).toBeDefined();
      expect(person.people_id).toBe(peopleId);
      expect(person.name).toBeDefined();
      expect(person.party).toBeDefined();
    });

    it("should get all session legislators", async () => {
      if (!sessionId) {
        console.log("Skipping: no session_id available");
        return;
      }

      const result = await client.getSessionPeople(sessionId);

      expect(result).toBeDefined();
      expect(result.people).toBeDefined();
      expect(Array.isArray(result.people)).toBe(true);
      expect(result.people.length).toBeGreaterThan(0);

      // Party breakdown (useful for salience analysis)
      const byParty: Record<string, number> = {};
      for (const person of result.people) {
        const party = person.party ?? "Unknown";
        byParty[party] = (byParty[party] ?? 0) + 1;
      }
      console.log("Legislators by party:", byParty);
    });

    it("should get sponsored bills list", async () => {
      if (!peopleId) {
        console.log("Skipping: no people_id available");
        return;
      }

      const sponsored = await client.getSponsoredList(peopleId);

      expect(sponsored).toBeDefined();
      // May be empty array if legislator hasn't sponsored anything
      expect(Array.isArray(sponsored)).toBe(true);
    });
  });

  describe("Master List Operations", () => {
    it("should get master bill list for session", async () => {
      const result = await client.getMasterList({ state: TEST_STATE });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);

      // Each item should have bill_id
      expect(result[0].bill_id).toBeDefined();
    });

    it("should get raw master list for syncing", async () => {
      const result = await client.getMasterListRaw({ state: TEST_STATE });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
