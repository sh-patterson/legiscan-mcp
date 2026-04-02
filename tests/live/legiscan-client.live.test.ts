// Comprehensive tests for LegiScan API Client
// Tests all 18 API operations against the real LegiScan API

import { describe, it, expect, beforeAll } from "vitest";
import { config } from "dotenv";
import { LegiScanClient, LegiScanError } from "../../src/legiscan-client.js";

// Load environment variables
config();

// Test configuration
const API_KEY = process.env.LEGISCAN_API_KEY;

// Skip all tests if no API key is configured
const describeWithApi = API_KEY ? describe : describe.skip;

// Test data - using California as the primary test state
const TEST_STATE = "CA";
let TEST_SESSION_ID: number;
let TEST_BILL_ID: number;
let TEST_DOC_ID: number;
let TEST_ROLL_CALL_ID: number;
let TEST_PEOPLE_ID: number;
let TEST_AMENDMENT_ID: number | undefined;
let TEST_SUPPLEMENT_ID: number | undefined;

describeWithApi("LegiScan API Client", () => {
  let client: LegiScanClient;

  beforeAll(() => {
    client = new LegiScanClient(API_KEY!);
  });

  // ============================================
  // Constructor Tests
  // ============================================
  describe("Constructor", () => {
    it("should throw error if API key is missing", () => {
      expect(() => new LegiScanClient("")).toThrow(LegiScanError);
      expect(() => new LegiScanClient("")).toThrow("LegiScan API key is required");
    });

    it("should create client with valid API key", () => {
      const testClient = new LegiScanClient("test-key");
      expect(testClient).toBeInstanceOf(LegiScanClient);
    });
  });

  // ============================================
  // Session Operations Tests
  // ============================================
  describe("Session Operations", () => {
    describe("getSessionList", () => {
      it("should get sessions for a specific state", async () => {
        const sessions = await client.getSessionList(TEST_STATE);

        expect(Array.isArray(sessions)).toBe(true);
        expect(sessions.length).toBeGreaterThan(0);

        // Verify session structure
        const session = sessions[0];
        expect(session).toHaveProperty("session_id");
        expect(session).toHaveProperty("state_id");
        expect(session).toHaveProperty("year_start");
        expect(session).toHaveProperty("year_end");
        expect(session).toHaveProperty("session_name");
        expect(session).toHaveProperty("session_tag");

        // Store session_id for later tests
        // Find the most recent regular session
        const regularSession = sessions.find((s) => s.special === 0) || sessions[0];
        TEST_SESSION_ID = regularSession.session_id;

        console.log(
          `Using session: ${regularSession.session_name} (ID: ${TEST_SESSION_ID})`
        );
      });

      it("should get all sessions when no state is specified", async () => {
        const sessions = await client.getSessionList();

        expect(Array.isArray(sessions)).toBe(true);
        expect(sessions.length).toBeGreaterThan(50); // Should have sessions from many states
      });

      it("should include special session indicator", async () => {
        const sessions = await client.getSessionList(TEST_STATE);

        sessions.forEach((session) => {
          expect(typeof session.special).toBe("number");
          expect([0, 1]).toContain(session.special);
        });
      });
    });
  });

  // ============================================
  // Bill Operations Tests
  // ============================================
  describe("Bill Operations", () => {
    describe("getMasterList", () => {
      it("should get master list by state", async () => {
        const bills = await client.getMasterList({ state: TEST_STATE });

        expect(Array.isArray(bills)).toBe(true);
        expect(bills.length).toBeGreaterThan(0);

        // Verify bill structure
        const bill = bills[0];
        expect(bill).toHaveProperty("bill_id");
        expect(bill).toHaveProperty("number");
        expect(bill).toHaveProperty("title");
        expect(bill).toHaveProperty("change_hash");
        expect(bill).toHaveProperty("last_action_date");

        // Store bill_id for later tests
        TEST_BILL_ID = bill.bill_id;
        console.log(`Using bill: ${bill.number} (ID: ${TEST_BILL_ID})`);
      });

      it("should get master list by session_id", async () => {
        const bills = await client.getMasterList({ id: TEST_SESSION_ID });

        expect(Array.isArray(bills)).toBe(true);
        expect(bills.length).toBeGreaterThan(0);
      });
    });

    describe("getMasterListRaw", () => {
      it("should get raw master list with minimal data", async () => {
        const bills = await client.getMasterListRaw({ state: TEST_STATE });

        expect(Array.isArray(bills)).toBe(true);
        expect(bills.length).toBeGreaterThan(0);

        // Raw list should have minimal fields
        const bill = bills[0];
        expect(bill).toHaveProperty("bill_id");
        expect(bill).toHaveProperty("number");
        expect(bill).toHaveProperty("change_hash");
      });

      it("should get raw master list by session_id", async () => {
        const bills = await client.getMasterListRaw({ id: TEST_SESSION_ID });

        expect(Array.isArray(bills)).toBe(true);
        expect(bills.length).toBeGreaterThan(0);
      });
    });

    describe("getBill", () => {
      it("should get detailed bill information", async () => {
        const bill = await client.getBill(TEST_BILL_ID);

        expect(bill).toHaveProperty("bill_id", TEST_BILL_ID);
        expect(bill).toHaveProperty("bill_number");
        expect(bill).toHaveProperty("title");
        expect(bill).toHaveProperty("description");
        expect(bill).toHaveProperty("state_id");
        expect(bill).toHaveProperty("session_id");
        expect(bill).toHaveProperty("status");
        expect(bill).toHaveProperty("status_date");
        expect(bill).toHaveProperty("url");
        expect(bill).toHaveProperty("state_link");

        console.log(`Bill: ${bill.bill_number} - ${bill.title}`);
      });

      it("should include sponsors array", async () => {
        const bill = await client.getBill(TEST_BILL_ID);

        expect(bill).toHaveProperty("sponsors");
        expect(Array.isArray(bill.sponsors)).toBe(true);

        if (bill.sponsors.length > 0) {
          const sponsor = bill.sponsors[0];
          expect(sponsor).toHaveProperty("people_id");
          expect(sponsor).toHaveProperty("name");
          expect(sponsor).toHaveProperty("sponsor_type_id");

          // Store people_id for later tests
          TEST_PEOPLE_ID = sponsor.people_id;
          console.log(`Primary sponsor: ${sponsor.name} (ID: ${TEST_PEOPLE_ID})`);
        }
      });

      it("should include history array", async () => {
        const bill = await client.getBill(TEST_BILL_ID);

        expect(bill).toHaveProperty("history");
        expect(Array.isArray(bill.history)).toBe(true);

        if (bill.history.length > 0) {
          const history = bill.history[0];
          expect(history).toHaveProperty("date");
          expect(history).toHaveProperty("action");
          expect(history).toHaveProperty("chamber");
        }
      });

      it("should include texts array", async () => {
        const bill = await client.getBill(TEST_BILL_ID);

        expect(bill).toHaveProperty("texts");
        expect(Array.isArray(bill.texts)).toBe(true);

        if (bill.texts.length > 0) {
          const text = bill.texts[0];
          expect(text).toHaveProperty("doc_id");
          expect(text).toHaveProperty("date");
          expect(text).toHaveProperty("type");
          expect(text).toHaveProperty("mime");

          // Store doc_id for getBillText test
          TEST_DOC_ID = text.doc_id;
          console.log(`Using doc_id: ${TEST_DOC_ID} (${text.type})`);
        }
      });

      it("should include votes array", async () => {
        const bill = await client.getBill(TEST_BILL_ID);

        expect(bill).toHaveProperty("votes");
        expect(Array.isArray(bill.votes)).toBe(true);

        if (bill.votes.length > 0) {
          const vote = bill.votes[0];
          expect(vote).toHaveProperty("roll_call_id");
          expect(vote).toHaveProperty("date");
          expect(vote).toHaveProperty("desc");
          expect(vote).toHaveProperty("yea");
          expect(vote).toHaveProperty("nay");
          expect(vote).toHaveProperty("passed");

          // Store roll_call_id for getRollCall test
          TEST_ROLL_CALL_ID = vote.roll_call_id;
          console.log(`Using roll_call_id: ${TEST_ROLL_CALL_ID}`);
        }
      });

      it("should include amendments array if any exist", async () => {
        const bill = await client.getBill(TEST_BILL_ID);

        expect(bill).toHaveProperty("amendments");
        expect(Array.isArray(bill.amendments)).toBe(true);

        if (bill.amendments.length > 0) {
          const amendment = bill.amendments[0];
          expect(amendment).toHaveProperty("amendment_id");
          TEST_AMENDMENT_ID = amendment.amendment_id;
          console.log(`Using amendment_id: ${TEST_AMENDMENT_ID}`);
        }
      });

      it("should include supplements array if any exist", async () => {
        const bill = await client.getBill(TEST_BILL_ID);

        expect(bill).toHaveProperty("supplements");
        expect(Array.isArray(bill.supplements)).toBe(true);

        if (bill.supplements.length > 0) {
          const supplement = bill.supplements[0];
          expect(supplement).toHaveProperty("supplement_id");
          TEST_SUPPLEMENT_ID = supplement.supplement_id;
          console.log(`Using supplement_id: ${TEST_SUPPLEMENT_ID}`);
        }
      });

      it("should include subjects array", async () => {
        const bill = await client.getBill(TEST_BILL_ID);

        expect(bill).toHaveProperty("subjects");
        expect(Array.isArray(bill.subjects)).toBe(true);
      });

      it("should include calendar array", async () => {
        const bill = await client.getBill(TEST_BILL_ID);

        expect(bill).toHaveProperty("calendar");
        expect(Array.isArray(bill.calendar)).toBe(true);
      });

      it("should include sasts array (cross-references)", async () => {
        const bill = await client.getBill(TEST_BILL_ID);

        expect(bill).toHaveProperty("sasts");
        expect(Array.isArray(bill.sasts)).toBe(true);
      });
    });

    describe("getBillText", () => {
      it("should get bill text document", async () => {
        // Skip if no doc_id available
        if (!TEST_DOC_ID) {
          console.log("Skipping getBillText - no doc_id available");
          return;
        }

        const text = await client.getBillText(TEST_DOC_ID);

        expect(text).toHaveProperty("doc_id", TEST_DOC_ID);
        expect(text).toHaveProperty("bill_id");
        expect(text).toHaveProperty("date");
        expect(text).toHaveProperty("type");
        expect(text).toHaveProperty("mime");
        expect(text).toHaveProperty("doc");

        // Verify base64 content exists
        expect(typeof text.doc).toBe("string");
        expect(text.doc.length).toBeGreaterThan(0);

        console.log(`Bill text retrieved: ${text.type} (${text.mime})`);
      });
    });

    describe("getAmendment", () => {
      it("should get amendment document if available", async () => {
        if (!TEST_AMENDMENT_ID) {
          console.log(
            "Skipping getAmendment - no amendment_id available, finding one..."
          );

          // Try to find a bill with amendments
          const searchResult = await client.getSearch({
            state: TEST_STATE,
            query: "amendment",
          });
          for (const result of searchResult.results.slice(0, 5)) {
            const bill = await client.getBill(result.bill_id);
            if (bill.amendments.length > 0) {
              TEST_AMENDMENT_ID = bill.amendments[0].amendment_id;
              console.log(`Found amendment_id: ${TEST_AMENDMENT_ID}`);
              break;
            }
          }
        }

        if (!TEST_AMENDMENT_ID) {
          console.log("No amendments found - skipping test");
          return;
        }

        const amendment = await client.getAmendment(TEST_AMENDMENT_ID);

        expect(amendment).toHaveProperty("amendment_id", TEST_AMENDMENT_ID);
        expect(amendment).toHaveProperty("bill_id");
        expect(amendment).toHaveProperty("date");
        expect(amendment).toHaveProperty("title");
        expect(amendment).toHaveProperty("mime");
        expect(amendment).toHaveProperty("doc");

        console.log(`Amendment retrieved: ${amendment.title}`);
      });
    });

    describe("getSupplement", () => {
      it("should get supplement document if available", async () => {
        if (!TEST_SUPPLEMENT_ID) {
          console.log(
            "Skipping getSupplement - no supplement_id available, finding one..."
          );

          // Try to find a bill with supplements
          const searchResult = await client.getSearch({
            state: TEST_STATE,
            query: "fiscal note",
          });
          for (const result of searchResult.results.slice(0, 5)) {
            const bill = await client.getBill(result.bill_id);
            if (bill.supplements.length > 0) {
              TEST_SUPPLEMENT_ID = bill.supplements[0].supplement_id;
              console.log(`Found supplement_id: ${TEST_SUPPLEMENT_ID}`);
              break;
            }
          }
        }

        if (!TEST_SUPPLEMENT_ID) {
          console.log("No supplements found - skipping test");
          return;
        }

        const supplement = await client.getSupplement(TEST_SUPPLEMENT_ID);

        expect(supplement).toHaveProperty("supplement_id", TEST_SUPPLEMENT_ID);
        expect(supplement).toHaveProperty("bill_id");
        expect(supplement).toHaveProperty("date");
        expect(supplement).toHaveProperty("title");
        expect(supplement).toHaveProperty("mime");
        expect(supplement).toHaveProperty("doc");

        console.log(`Supplement retrieved: ${supplement.title}`);
      });
    });
  });

  // ============================================
  // Vote Operations Tests
  // ============================================
  describe("Vote Operations", () => {
    describe("getRollCall", () => {
      it("should get roll call vote details", async () => {
        if (!TEST_ROLL_CALL_ID) {
          console.log("Skipping getRollCall - no roll_call_id available, finding one...");

          // Try to find a bill with votes
          const masterList = await client.getMasterList({ state: TEST_STATE });
          for (const item of masterList.slice(0, 20)) {
            const bill = await client.getBill(item.bill_id);
            if (bill.votes.length > 0) {
              TEST_ROLL_CALL_ID = bill.votes[0].roll_call_id;
              console.log(`Found roll_call_id: ${TEST_ROLL_CALL_ID}`);
              break;
            }
          }
        }

        if (!TEST_ROLL_CALL_ID) {
          console.log("No roll calls found - skipping test");
          return;
        }

        const rollCall = await client.getRollCall(TEST_ROLL_CALL_ID);

        expect(rollCall).toHaveProperty("roll_call_id", TEST_ROLL_CALL_ID);
        expect(rollCall).toHaveProperty("bill_id");
        expect(rollCall).toHaveProperty("date");
        expect(rollCall).toHaveProperty("desc");
        expect(rollCall).toHaveProperty("yea");
        expect(rollCall).toHaveProperty("nay");
        expect(rollCall).toHaveProperty("nv");
        expect(rollCall).toHaveProperty("absent");
        expect(rollCall).toHaveProperty("passed");
        expect(rollCall).toHaveProperty("chamber");
        expect(rollCall).toHaveProperty("votes");

        // Verify votes array structure
        expect(Array.isArray(rollCall.votes)).toBe(true);

        if (rollCall.votes.length > 0) {
          const vote = rollCall.votes[0];
          expect(vote).toHaveProperty("people_id");
          expect(vote).toHaveProperty("vote_id");
          expect(vote).toHaveProperty("vote_text");
        }

        console.log(
          `Roll call: ${rollCall.desc} - Yea: ${rollCall.yea}, Nay: ${rollCall.nay}`
        );
      });
    });
  });

  // ============================================
  // People Operations Tests
  // ============================================
  describe("People Operations", () => {
    describe("getPerson", () => {
      it("should get legislator information", async () => {
        if (!TEST_PEOPLE_ID) {
          // Get a person from session people
          const sessionPeople = await client.getSessionPeople(TEST_SESSION_ID);
          TEST_PEOPLE_ID = sessionPeople.people[0].people_id;
        }

        const person = await client.getPerson(TEST_PEOPLE_ID);

        expect(person).toHaveProperty("people_id", TEST_PEOPLE_ID);
        expect(person).toHaveProperty("name");
        expect(person).toHaveProperty("first_name");
        expect(person).toHaveProperty("last_name");
        expect(person).toHaveProperty("party_id");
        expect(person).toHaveProperty("party");
        expect(person).toHaveProperty("role_id");
        expect(person).toHaveProperty("role");
        expect(person).toHaveProperty("state_id");
        expect(person).toHaveProperty("district");

        console.log(
          `Person: ${person.name} (${person.party}) - ${person.role}, District ${person.district}`
        );
      });

      it("should include third-party IDs (votesmart, ftm_eid, opensecrets)", async () => {
        if (!TEST_PEOPLE_ID) return;

        const person = await client.getPerson(TEST_PEOPLE_ID);

        // These may be 0 or empty if not linked
        expect(person).toHaveProperty("votesmart_id");
        expect(person).toHaveProperty("ftm_eid"); // Follow the Money EID
        expect(person).toHaveProperty("opensecrets_id");
        expect(person).toHaveProperty("ballotpedia");

        expect(typeof person.votesmart_id).toBe("number");
      });
    });

    describe("getSessionPeople", () => {
      it("should get all legislators in a session", async () => {
        const sessionPeople = await client.getSessionPeople(TEST_SESSION_ID);

        expect(sessionPeople).toHaveProperty("session");
        expect(sessionPeople).toHaveProperty("people");

        // Verify session info
        expect(sessionPeople.session).toHaveProperty("session_id", TEST_SESSION_ID);
        expect(sessionPeople.session).toHaveProperty("session_name");
        expect(sessionPeople.session).toHaveProperty("state_id");

        // Verify people array
        expect(Array.isArray(sessionPeople.people)).toBe(true);
        expect(sessionPeople.people.length).toBeGreaterThan(0);

        // California should have 120 legislators (80 Assembly + 40 Senate)
        expect(sessionPeople.people.length).toBeGreaterThanOrEqual(100);

        const legislator = sessionPeople.people[0];
        expect(legislator).toHaveProperty("people_id");
        expect(legislator).toHaveProperty("name");
        expect(legislator).toHaveProperty("party");
        expect(legislator).toHaveProperty("role");

        console.log(`Session has ${sessionPeople.people.length} legislators`);
      });
    });

    describe("getSponsoredList", () => {
      it("should get bills sponsored by a legislator", async () => {
        if (!TEST_PEOPLE_ID) {
          const sessionPeople = await client.getSessionPeople(TEST_SESSION_ID);
          TEST_PEOPLE_ID = sessionPeople.people[0].people_id;
        }

        // getSponsoredList now returns just the bills array (SponsoredBillItem[])
        const sponsoredBills = await client.getSponsoredList(TEST_PEOPLE_ID);

        expect(Array.isArray(sponsoredBills)).toBe(true);

        if (sponsoredBills.length > 0) {
          const bill = sponsoredBills[0];
          expect(bill).toHaveProperty("bill_id");
          expect(bill).toHaveProperty("number");
          expect(bill).toHaveProperty("session_id");
        }

        console.log(`Found ${sponsoredBills.length} sponsored bills`);
      });

      it("should get full sponsored list with sponsor info", async () => {
        if (!TEST_PEOPLE_ID) {
          const sessionPeople = await client.getSessionPeople(TEST_SESSION_ID);
          TEST_PEOPLE_ID = sessionPeople.people[0].people_id;
        }

        // getSponsoredListFull returns the complete object with sponsor, sessions, and bills
        const sponsoredBills = await client.getSponsoredListFull(TEST_PEOPLE_ID);

        expect(sponsoredBills).toHaveProperty("sponsor");
        expect(sponsoredBills).toHaveProperty("sessions");
        expect(sponsoredBills).toHaveProperty("bills");

        // Verify sponsor info
        expect(sponsoredBills.sponsor).toHaveProperty("people_id", TEST_PEOPLE_ID);
        expect(sponsoredBills.sponsor).toHaveProperty("name");

        console.log(
          `Found ${sponsoredBills.bills.length} sponsored bills across ${sponsoredBills.sessions.length} sessions`
        );
      });
    });
  });

  // ============================================
  // Search Operations Tests
  // ============================================
  describe("Search Operations", () => {
    describe("getSearch", () => {
      it("should search for bills by query", async () => {
        const result = await client.getSearch({
          state: TEST_STATE,
          query: "housing",
        });

        expect(result).toHaveProperty("summary");
        expect(result).toHaveProperty("results");

        // Verify summary
        expect(result.summary).toHaveProperty("count");
        expect(result.summary).toHaveProperty("page");
        expect(result.summary).toHaveProperty("page_current");
        expect(result.summary).toHaveProperty("page_total");
        expect(typeof result.summary.count).toBe("number");

        // Verify results
        expect(Array.isArray(result.results)).toBe(true);
        expect(result.results.length).toBeLessThanOrEqual(50); // 50 per page max

        if (result.results.length > 0) {
          const item = result.results[0];
          expect(item).toHaveProperty("bill_id");
          expect(item).toHaveProperty("bill_number");
          expect(item).toHaveProperty("title");
          expect(item).toHaveProperty("relevance");
          expect(item).toHaveProperty("state");
          expect(item).toHaveProperty("last_action_date");
        }

        console.log(`Found ${result.summary.count} results for "housing"`);
      });

      it("should search with year filter", async () => {
        const result = await client.getSearch({
          state: TEST_STATE,
          query: "climate",
          year: 2024,
        });

        expect(result.summary.count).toBeGreaterThanOrEqual(0);

        console.log(`Found ${result.summary.count} climate bills in 2024`);
      });

      it("should support pagination", async () => {
        const page1 = await client.getSearch({
          state: TEST_STATE,
          query: "education",
          page: 1,
        });

        const page2 = await client.getSearch({
          state: TEST_STATE,
          query: "education",
          page: 2,
        });

        // Both pages should have same total count
        expect(page1.summary.count).toBe(page2.summary.count);

        // But different current pages (API returns these as strings)
        expect(String(page1.summary.page_current)).toBe("1");
        expect(String(page2.summary.page_current)).toBe("2");

        // And different results
        if (page1.results.length > 0 && page2.results.length > 0) {
          expect(page1.results[0].bill_id).not.toBe(page2.results[0].bill_id);
        }
      });

      it("should search ALL states", async () => {
        const result = await client.getSearch({
          query: "cannabis",
        });

        expect(result.summary.count).toBeGreaterThan(0);

        // Should have results from multiple states
        const states = new Set(result.results.map((r) => r.state));
        expect(states.size).toBeGreaterThan(1);

        console.log(`Found "cannabis" bills in ${states.size} states`);
      });

      it("should search by session_id", async () => {
        const result = await client.getSearch({
          session_id: TEST_SESSION_ID,
          query: "tax",
        });

        expect(result).toHaveProperty("summary");
        expect(result).toHaveProperty("results");

        console.log(
          `Found ${result.summary.count} "tax" bills in session ${TEST_SESSION_ID}`
        );
      });

      it("should canonicalize compact bill numbers even when session_id is provided", async () => {
        const result = await client.getSearch({
          session_id: 2172,
          query: "AB858",
        });

        expect(result.results.length).toBeGreaterThan(0);
        expect(
          result.results.some(
            (item) => item.bill_number.replace(/\s/g, "").toUpperCase() === "AB858"
          )
        ).toBe(true);
      });
    });

    describe("getSearchRaw", () => {
      it("should return raw search results (2000 per page)", async () => {
        const result = await client.getSearchRaw({
          state: TEST_STATE,
          query: "health",
        });

        expect(result).toHaveProperty("summary");
        expect(result).toHaveProperty("results");

        // Raw results can have up to 2000 per page
        expect(result.results.length).toBeLessThanOrEqual(2000);

        // Raw results have minimal fields
        if (result.results.length > 0) {
          const item = result.results[0];
          expect(item).toHaveProperty("bill_id");
          expect(item).toHaveProperty("change_hash");
          expect(item).toHaveProperty("relevance");
        }

        console.log(`Raw search found ${result.summary.count} "health" bills`);
      });
    });
  });

  // ============================================
  // Dataset Operations Tests
  // ============================================
  describe("Dataset Operations", () => {
    describe("getDatasetList", () => {
      it("should list available datasets", async () => {
        const datasets = await client.getDatasetList();

        expect(Array.isArray(datasets)).toBe(true);
        expect(datasets.length).toBeGreaterThan(0);

        const dataset = datasets[0];
        expect(dataset).toHaveProperty("session_id");
        expect(dataset).toHaveProperty("state_id");
        expect(dataset).toHaveProperty("session_name");
        expect(dataset).toHaveProperty("access_key");
        expect(dataset).toHaveProperty("dataset_date");
        expect(dataset).toHaveProperty("dataset_size");
        expect(dataset).toHaveProperty("dataset_hash");

        console.log(`Found ${datasets.length} total datasets`);
      });

      it("should filter datasets by state", async () => {
        const datasets = await client.getDatasetList({ state: TEST_STATE });

        expect(Array.isArray(datasets)).toBe(true);
        expect(datasets.length).toBeGreaterThan(0);

        // All datasets should be for the specified state (verified by state_id)
        // California is state_id 5
        datasets.forEach((dataset) => {
          expect(dataset.state_id).toBe(5); // CA = 5
        });

        console.log(`Found ${datasets.length} ${TEST_STATE} datasets`);
      });

      it("should filter datasets by year", async () => {
        const datasets = await client.getDatasetList({ year: 2023 });

        expect(Array.isArray(datasets)).toBe(true);

        console.log(`Found ${datasets.length} datasets for 2023`);
      });

      it("should filter datasets by state and year", async () => {
        const datasets = await client.getDatasetList({
          state: TEST_STATE,
          year: 2023,
        });

        expect(Array.isArray(datasets)).toBe(true);

        datasets.forEach((dataset) => {
          expect(dataset.state_id).toBe(5); // CA = 5
        });

        console.log(`Found ${datasets.length} ${TEST_STATE} 2023 datasets`);
      });
    });

    describe("getDataset", () => {
      it("should download dataset archive", async () => {
        // Get fresh dataset list to get valid access key
        const datasets = await client.getDatasetList({ state: TEST_STATE });

        if (datasets.length === 0) {
          console.log("No datasets available - skipping test");
          return;
        }

        const targetDataset = datasets[0];
        console.log(`Downloading dataset: ${targetDataset.session_name}`);

        const archive = await client.getDataset(
          targetDataset.session_id,
          targetDataset.access_key
        );

        expect(archive).toHaveProperty("session_id", targetDataset.session_id);
        expect(archive).toHaveProperty("state_id");
        expect(archive).toHaveProperty("session_name");
        expect(archive).toHaveProperty("dataset_date");
        expect(archive).toHaveProperty("mime_type");
        expect(archive).toHaveProperty("zip");

        // Verify it's base64 encoded zip
        expect(archive.mime_type).toBe("application/zip");
        expect(typeof archive.zip).toBe("string");
        expect(archive.zip.length).toBeGreaterThan(0);

        console.log(
          `Downloaded dataset: ${archive.session_name} (${Math.round(archive.zip.length / 1024)}KB base64)`
        );
      });
    });
  });

  // ============================================
  // Monitor Operations Tests (GAITS)
  // ============================================
  describe("Monitor Operations (GAITS)", () => {
    describe("getMonitorList", () => {
      it("should get current monitor list", async () => {
        const monitorList = await client.getMonitorList();

        // Monitor list returns an array (may be empty if no bills tracked)
        expect(Array.isArray(monitorList)).toBe(true);

        // If there are items, verify structure
        if (monitorList.length > 0) {
          const item = monitorList[0];
          expect(item).toHaveProperty("bill_id");
          expect(item).toHaveProperty("number");
          expect(item).toHaveProperty("title");
          expect(item).toHaveProperty("status");
          expect(item).toHaveProperty("change_hash");
        }

        console.log(`Monitor list has ${monitorList.length} bills`);
      });

      it("should get monitor list by record type", async () => {
        const currentList = await client.getMonitorList("current");
        const archivedList = await client.getMonitorList("archived");

        expect(Array.isArray(currentList)).toBe(true);
        expect(Array.isArray(archivedList)).toBe(true);

        console.log(`Current: ${currentList.length}, Archived: ${archivedList.length}`);
      });
    });

    describe("getMonitorListRaw", () => {
      it("should get raw monitor list with minimal data", async () => {
        const rawList = await client.getMonitorListRaw();

        expect(Array.isArray(rawList)).toBe(true);

        if (rawList.length > 0) {
          const item = rawList[0];
          expect(item).toHaveProperty("bill_id");
          expect(item).toHaveProperty("change_hash");
        }

        console.log(`Raw monitor list has ${rawList.length} bills`);
      });
    });

    // GAITS mutation tests are opt-in to avoid modifying real monitor lists
    const describeMutation = process.env.LEGISCAN_TEST_MUTATIONS
      ? describe
      : describe.skip;

    describeMutation("setMonitor", () => {
      // Note: These tests modify the user's monitor list
      // Run with LEGISCAN_TEST_MUTATIONS=1 to enable

      it("should add and remove a bill from monitor list", async () => {
        // Skip if we don't have a test bill
        if (!TEST_BILL_ID) {
          console.log("Skipping setMonitor - no test bill available");
          return;
        }

        // Add bill to monitor
        const addResult = await client.setMonitor({
          list: String(TEST_BILL_ID),
          action: "monitor",
          stance: "watch",
        });

        expect(typeof addResult).toBe("object");
        console.log(`Add to monitor result:`, addResult);

        // Remove bill from monitor
        const removeResult = await client.setMonitor({
          list: String(TEST_BILL_ID),
          action: "remove",
        });

        expect(typeof removeResult).toBe("object");
        console.log(`Remove from monitor result:`, removeResult);
      });
    });
  });

  // ============================================
  // Error Handling Tests
  // ============================================
  describe("Error Handling", () => {
    it("should throw LegiScanError for invalid bill_id", async () => {
      await expect(client.getBill(999999999)).rejects.toThrow(LegiScanError);
    });

    it("should throw LegiScanError for invalid roll_call_id", async () => {
      await expect(client.getRollCall(999999999)).rejects.toThrow(LegiScanError);
    });

    it("should throw LegiScanError for invalid people_id", async () => {
      await expect(client.getPerson(999999999)).rejects.toThrow(LegiScanError);
    });

    it("should throw LegiScanError for invalid session_id", async () => {
      await expect(client.getSessionPeople(999999999)).rejects.toThrow(LegiScanError);
    });

    it("should throw LegiScanError for invalid doc_id", async () => {
      await expect(client.getBillText(999999999)).rejects.toThrow(LegiScanError);
    });

    it("should throw error for invalid state", async () => {
      // Invalid state throws LegiScanError
      await expect(client.getSessionList("ZZ")).rejects.toThrow(LegiScanError);
    });
  });

  // ============================================
  // API Configuration Verification
  // ============================================
  describe("API Configuration Verification", () => {
    it("should use correct API base URL", async () => {
      // Verify by making a successful request
      const sessions = await client.getSessionList(TEST_STATE);
      expect(sessions.length).toBeGreaterThan(0);
    });

    it("should properly include all required parameters", async () => {
      // Test that complex operations include all params correctly
      const result = await client.getSearch({
        state: TEST_STATE,
        query: "test",
        year: 2024,
        page: 1,
      });

      expect(result.summary).toBeDefined();
    });

    it("should handle optional parameters correctly", async () => {
      // Some params are optional - verify they work when omitted
      const datasets1 = await client.getDatasetList();
      const datasets2 = await client.getDatasetList({ state: TEST_STATE });
      const datasets3 = await client.getDatasetList({ year: 2024 });

      expect(Array.isArray(datasets1)).toBe(true);
      expect(Array.isArray(datasets2)).toBe(true);
      expect(Array.isArray(datasets3)).toBe(true);
    });
  });
});

// Additional standalone tests that don't need shared state
describe("LegiScanClient (standalone)", () => {
  it("should skip tests if no API key is configured", () => {
    if (!API_KEY) {
      console.log("⚠️  LEGISCAN_API_KEY not set - skipping API tests");
      console.log("Set LEGISCAN_API_KEY in .env file to run full test suite");
    }
    expect(true).toBe(true);
  });
});
