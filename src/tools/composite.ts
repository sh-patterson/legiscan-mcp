// Composite MCP tools for common research workflows
// These tools batch multiple API calls to dramatically reduce complexity

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LegiScanClient } from "../legiscan-client.js";
import type { Person, Sponsor, Session } from "../types/legiscan.js";
import { jsonResponse, errorResponse, stateCodeSchema } from "./helpers.js";

// ============================================
// Helper Functions
// ============================================

/**
 * Get current (most recent active) session for a state
 */
async function getCurrentSession(
  client: LegiScanClient,
  state: string
): Promise<Session> {
  const sessions = await client.getSessionList(state);

  if (sessions.length === 0) {
    throw new Error(`No sessions found for state "${state}"`);
  }

  // Prefer active sessions (sine_die === 0), sort by year descending
  const active = sessions
    .filter((s) => s.sine_die === 0)
    .sort((a, b) => b.year_end - a.year_end);
  if (active.length > 0) return active[0];
  // Fallback to most recent session
  return sessions.sort((a, b) => b.year_end - a.year_end)[0];
}

/**
 * Process items in batches while deduplicating repeated lookups within a request.
 * The returned array preserves the original item order.
 */
async function processBatchedCached<T, K, R>(
  items: T[],
  getKey: (item: T) => K,
  processor: (item: T) => Promise<R>,
  batchSize: number = 10
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  const cachedResults = new Map<K, PromiseSettledResult<R>>();
  const uniqueItems: Array<{ key: K; item: T }> = [];

  for (const item of items) {
    const key = getKey(item);
    if (!cachedResults.has(key)) {
      cachedResults.set(key, {
        status: "rejected",
        reason: new Error("Uninitialized cache"),
      });
      uniqueItems.push({ key, item });
    }
  }

  for (let i = 0; i < uniqueItems.length; i += batchSize) {
    const batch = uniqueItems.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async ({ key, item }) => {
        try {
          return {
            key,
            result: {
              status: "fulfilled" as const,
              value: await processor(item),
            },
          };
        } catch (error) {
          return {
            key,
            result: {
              status: "rejected" as const,
              reason: error,
            },
          };
        }
      })
    );

    for (const { key, result } of batchResults) {
      cachedResults.set(key, result);
    }
  }

  for (let i = 0; i < items.length; i++) {
    results[i] = cachedResults.get(getKey(items[i]))!;
  }

  return results;
}

function createCachedFetcher<K, R>(fetcher: (key: K) => Promise<R>) {
  const cache = new Map<K, Promise<R>>();

  return (key: K) => {
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }

    const pending = fetcher(key);
    cache.set(key, pending);
    return pending;
  };
}

/**
 * Format error reason for display
 */
function formatError(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return String(reason);
}

/**
 * Case-insensitive name matching
 * Matches if query appears in name, first_name, last_name, or nickname
 */
function matchesName(person: Person, query: string): boolean {
  const q = query.toLowerCase().trim();
  const tokens = q.split(/\s+/);

  const fullName = person.name.toLowerCase();
  const firstName = person.first_name.toLowerCase();
  const lastName = person.last_name.toLowerCase();
  const nickname = (person.nickname || "").toLowerCase();

  // Match if full query is contained in full name
  if (fullName.includes(q)) return true;

  // Match if all tokens match at least one field
  return tokens.every(
    (token) =>
      firstName.includes(token) ||
      lastName.includes(token) ||
      fullName.includes(token) ||
      nickname.includes(token)
  );
}

/**
 * Check if a sponsor is the primary author of a bill
 * Primary author = sponsor_type_id === 1 (PrimarySponsor) OR sponsor_order === 1
 */
function isPrimaryAuthor(sponsor: Sponsor): boolean {
  return sponsor.sponsor_type_id === 1 || sponsor.sponsor_order === 1;
}

// ============================================
// Composite Tool Registration
// ============================================

export function registerCompositeTools(server: McpServer, client: LegiScanClient) {
  // ============================================
  // Tool 1: Get Legislator Votes (BIGGEST WIN)
  // ============================================
  server.tool(
    "legiscan_get_legislator_votes",
    "Get how a legislator voted on specific bills. Use find_legislator first to get people_id from a name. Returns vote positions (Yea/Nay/NV/Absent) for each bill with roll call details.",
    {
      people_id: z
        .number()
        .describe("Legislator ID (use find_legislator to resolve from name)"),
      bill_ids: z
        .array(z.number())
        .min(1, "bill_ids must include at least one bill_id")
        .max(100, "bill_ids supports up to 100 bills per request")
        .describe("Array of bill_ids to check votes on (max 100)"),
      chamber: z
        .enum(["H", "S", "A"])
        .optional()
        .describe("Optional chamber filter (H=House, S=Senate, A=Assembly)"),
    },
    async ({ people_id, bill_ids, chamber }) => {
      try {
        const votes: Array<{
          bill_id: number;
          bill_number: string;
          title: string;
          roll_call_id: number;
          date: string;
          description: string;
          chamber: string;
          passed: boolean;
          vote: string;
          vote_id: number;
        }> = [];
        const errors: string[] = [];
        let legislatorName = "";

        const getBillCached = createCachedFetcher((billId: number) =>
          client.getBill(billId)
        );
        const getRollCallCached = createCachedFetcher((rollCallId: number) =>
          client.getRollCall(rollCallId)
        );

        // Fetch all bills in batches to avoid rate limits
        const billResults = await processBatchedCached(
          bill_ids,
          (billId) => billId,
          (billId) => getBillCached(billId)
        );

        for (let i = 0; i < billResults.length; i++) {
          const result = billResults[i];
          const billId = bill_ids[i];

          if (result.status === "rejected") {
            errors.push(`Bill ${billId}: ${formatError(result.reason)}`);
            continue;
          }

          const bill = result.value;

          // Filter votes by chamber if specified
          let voteRefs = bill.votes || [];
          if (chamber) {
            const chamberMap: Record<string, string> = {
              H: "H",
              S: "S",
              A: "A",
            };
            voteRefs = voteRefs.filter((v) => v.chamber === chamberMap[chamber]);
          }

          // Fetch all roll calls for this bill in batches
          const rollCallResults = await processBatchedCached(
            voteRefs,
            (voteRef) => voteRef.roll_call_id,
            (voteRef) => getRollCallCached(voteRef.roll_call_id)
          );

          for (let j = 0; j < rollCallResults.length; j++) {
            const rcResult = rollCallResults[j];
            const voteRef = voteRefs[j];

            if (rcResult.status === "rejected") {
              errors.push(
                `Roll call ${voteRef.roll_call_id}: ${formatError(rcResult.reason)}`
              );
              continue;
            }

            const rollCall = rcResult.value;

            // Find this legislator's vote
            const individualVote = rollCall.votes.find((v) => v.people_id === people_id);

            if (individualVote) {
              // Try to get legislator name from bill sponsors
              if (!legislatorName) {
                const sponsor = bill.sponsors.find((s) => s.people_id === people_id);
                if (sponsor) legislatorName = sponsor.name;
              }

              votes.push({
                bill_id: bill.bill_id,
                bill_number: bill.bill_number,
                title: bill.title,
                roll_call_id: rollCall.roll_call_id,
                date: rollCall.date,
                description: rollCall.desc,
                chamber: rollCall.chamber,
                passed: rollCall.passed === 1,
                vote: individualVote.vote_text,
                vote_id: individualVote.vote_id,
              });
            }
          }
        }

        // Calculate summary
        const summary = {
          total_votes: votes.length,
          yea: votes.filter((v) => v.vote_id === 1).length,
          nay: votes.filter((v) => v.vote_id === 2).length,
          nv: votes.filter((v) => v.vote_id === 3).length,
          absent: votes.filter((v) => v.vote_id === 4).length,
        };

        return jsonResponse({
          legislator: {
            people_id,
            name: legislatorName || `Legislator ${people_id}`,
          },
          votes,
          summary,
          errors: errors.length > 0 ? errors : undefined,
        });
      } catch (error) {
        return errorResponse(error);
      }
    }
  );

  // ============================================
  // Tool 2: Get Primary Authored Bills (SECOND WIN)
  // ============================================
  server.tool(
    "legiscan_get_primary_authored",
    "Get only bills where a legislator is the PRIMARY author, not co-sponsor. Use find_legislator first to get people_id from a name. Pass state or session_id when you want results scoped to a specific legislature and timeframe; otherwise this returns all available sessions for that legislator.",
    {
      people_id: z
        .number()
        .describe("Legislator ID (use find_legislator to resolve from name)"),
      session_id: z
        .number()
        .optional()
        .describe(
          "Optional session ID to scope results. Reuse session.session_id from find_legislator when you want a specific session."
        ),
      state: stateCodeSchema
        .optional()
        .describe(
          "Optional state abbreviation to scope results when session_id is not provided. Uses the current session for that state."
        ),
    },
    async ({ people_id, session_id, state }) => {
      try {
        // Get all sponsored bills
        const sponsoredBills = await client.getSponsoredList(people_id);

        // Filter by session if specified
        let filteredBills = sponsoredBills;
        let scope:
          | { type: "all_sessions" }
          | { type: "session"; session_id: number }
          | { type: "current_session_for_state"; state: string; session_id: number } = {
          type: "all_sessions",
        };
        if (session_id) {
          filteredBills = sponsoredBills.filter((b) => b.session_id === session_id);
          scope = { type: "session", session_id };
        } else if (state) {
          // Get current session for state and filter
          const currentSession = await getCurrentSession(client, state);
          filteredBills = sponsoredBills.filter(
            (b) => b.session_id === currentSession.session_id
          );
          scope = {
            type: "current_session_for_state",
            state,
            session_id: currentSession.session_id,
          };
        }

        const primaryAuthored: Array<{
          bill_id: number;
          bill_number: string;
          title: string;
          description: string;
          session_id: number;
          status: string;
          status_date: string;
          sponsor_order: number;
          sponsor_type: string;
        }> = [];
        const errors: string[] = [];
        let legislatorName = "";
        const getBillCached = createCachedFetcher((billId: number) =>
          client.getBill(billId)
        );

        // Fetch all bill details in batches to avoid rate limits
        const billResults = await processBatchedCached(
          filteredBills,
          (billInfo) => billInfo.bill_id,
          (billInfo) => getBillCached(billInfo.bill_id)
        );

        for (let i = 0; i < billResults.length; i++) {
          const result = billResults[i];
          const billInfo = filteredBills[i];

          if (result.status === "rejected") {
            errors.push(`Bill ${billInfo.bill_id}: ${formatError(result.reason)}`);
            continue;
          }

          const bill = result.value;

          // Find this legislator's sponsorship
          const sponsor = bill.sponsors.find((s) => s.people_id === people_id);

          if (sponsor && isPrimaryAuthor(sponsor)) {
            if (!legislatorName) legislatorName = sponsor.name;

            // Map sponsor_type_id to readable string
            const sponsorTypeMap: Record<number, string> = {
              0: "Sponsor",
              1: "Primary Sponsor",
              2: "Co-Sponsor",
              3: "Joint Sponsor",
            };

            primaryAuthored.push({
              bill_id: bill.bill_id,
              bill_number: bill.bill_number,
              title: bill.title,
              description: bill.description,
              session_id: bill.session_id,
              status: bill.status.toString(),
              status_date: bill.status_date,
              sponsor_order: sponsor.sponsor_order,
              sponsor_type: sponsorTypeMap[sponsor.sponsor_type_id] || "Unknown",
            });
          }
        }

        return jsonResponse({
          legislator: {
            people_id,
            name: legislatorName || `Legislator ${people_id}`,
          },
          scope,
          total_sponsored: filteredBills.length,
          total_sponsored_all_sessions:
            filteredBills.length === sponsoredBills.length
              ? undefined
              : sponsoredBills.length,
          primary_count: primaryAuthored.length,
          primary_authored: primaryAuthored,
          errors: errors.length > 0 ? errors : undefined,
        });
      } catch (error) {
        return errorResponse(error);
      }
    }
  );

  // ============================================
  // Tool 3: Find Legislator by Name (CONVENIENCE)
  // ============================================
  server.tool(
    "legiscan_find_legislator",
    "Find a legislator's people_id by searching their name. Useful as a first step before other queries. Supports partial name matching.",
    {
      name: z
        .string()
        .trim()
        .min(2, "name must be at least 2 characters")
        .describe("Full or partial name to search (e.g., 'Smith', 'Jane Smith')"),
      state: stateCodeSchema.describe("Two-letter state abbreviation (e.g., 'CA')"),
      session_id: z
        .number()
        .optional()
        .describe("Optional specific session_id (default: current session)"),
    },
    async ({ name, state, session_id }) => {
      try {
        // Get session
        let session: Session;
        if (session_id) {
          const sessions = await client.getSessionList(state);
          const found = sessions.find((s) => s.session_id === session_id);
          if (!found) {
            return errorResponse(`Session ${session_id} not found for ${state}`);
          }
          session = found;
        } else {
          session = await getCurrentSession(client, state);
        }

        // Get all legislators in session
        const sessionPeople = await client.getSessionPeople(session.session_id);

        // Find matches
        const matches = sessionPeople.people.filter((person) =>
          matchesName(person, name)
        );

        return jsonResponse({
          query: name,
          session: {
            session_id: session.session_id,
            session_name: session.session_name,
            state,
          },
          matches: matches.map((p) => ({
            people_id: p.people_id,
            name: p.name,
            first_name: p.first_name,
            last_name: p.last_name,
            party: p.party,
            role: p.role,
            district: p.district,
            ballotpedia: p.ballotpedia,
          })),
          match_count: matches.length,
        });
      } catch (error) {
        return errorResponse(error);
      }
    }
  );
}
