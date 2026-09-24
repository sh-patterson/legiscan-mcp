// Composite MCP tools for common research workflows
// These tools batch multiple API calls to dramatically reduce complexity

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LegiScanClient } from "../legiscan-client.js";
import {
  SponsorType,
  type Person,
  type Sponsor,
  type Session,
} from "../types/legiscan.js";
import { jsonResponse, errorResponse, stateCodeSchema } from "./helpers.js";

// ============================================
// Helper Functions
// ============================================

const SPONSOR_TYPE_NAMES: Record<number, string> = {
  0: "Sponsor",
  1: "Primary Sponsor",
  2: "Co-Sponsor",
  3: "Joint Sponsor",
};

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
 * Process each distinct item once in batches, preserving first-seen order.
 */
async function processUniqueBatched<T, K, R>(
  items: T[],
  getKey: (item: T) => K,
  processor: (item: T) => Promise<R>,
  batchSize: number = 10
): Promise<Array<{ item: T; result: PromiseSettledResult<R> }>> {
  const seenKeys = new Set<K>();
  const uniqueItems = items.filter((item) => {
    const key = getKey(item);
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });
  const results: Array<{ item: T; result: PromiseSettledResult<R> }> = [];

  for (let i = 0; i < uniqueItems.length; i += batchSize) {
    const batch = uniqueItems.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map((item) => Promise.resolve().then(() => processor(item)))
    );
    results.push(...batch.map((item, index) => ({ item, result: batchResults[index] })));
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

function isPrimaryAuthor(sponsor: Sponsor): boolean {
  return sponsor.sponsor_type_id === SponsorType.PrimarySponsor;
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
    "Get how a legislator voted on specific bills. Use find_legislator first to get people_id from a name. Returns vote positions (Yea/Nay/NV/Absent) for each bill with roll call details. Duplicate bill_ids are deduplicated. Roll calls are checked most recent first, in pages of max_roll_calls_per_bill (default 5); use each bill's next_offset to check older roll calls.",
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
      max_roll_calls_per_bill: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .default(5)
        .describe(
          "Max roll calls to fetch per bill (default 5, most recent first). Lower values reduce API quota usage."
        ),
      roll_call_offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .default(0)
        .describe("Number of newer roll calls to skip per bill when continuing a search"),
    },
    async ({
      people_id,
      bill_ids,
      chamber,
      max_roll_calls_per_bill,
      roll_call_offset,
    }) => {
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
        const roll_call_coverage: Array<{
          bill_id: number;
          available: number;
          selected: number;
          offset: number;
          next_offset?: number;
        }> = [];
        const errors: string[] = [];
        let legislatorName = "";

        const getRollCallCached = createCachedFetcher((rollCallId: number) =>
          client.getRollCall(rollCallId)
        );

        // Fetch all bills in batches to avoid rate limits
        const billResults = await processUniqueBatched(
          bill_ids,
          (billId) => billId,
          (billId) => client.getBill(billId)
        );

        for (const { item: billId, result } of billResults) {
          if (result.status === "rejected") {
            errors.push(`Bill ${billId}: ${formatError(result.reason)}`);
            continue;
          }

          const bill = result.value;

          let voteRefs = bill.votes || [];
          if (chamber) {
            voteRefs = voteRefs.filter((v) => v.chamber === chamber);
          }

          voteRefs = [...voteRefs].sort((a, b) => b.date.localeCompare(a.date));
          const available = voteRefs.length;
          voteRefs = voteRefs.slice(
            roll_call_offset,
            roll_call_offset + max_roll_calls_per_bill
          );
          const nextOffset = roll_call_offset + voteRefs.length;
          roll_call_coverage.push({
            bill_id: billId,
            available,
            selected: voteRefs.length,
            offset: roll_call_offset,
            next_offset: nextOffset < available ? nextOffset : undefined,
          });

          // Fetch all roll calls for this bill in batches
          const rollCallResults = await processUniqueBatched(
            voteRefs,
            (voteRef) => voteRef.roll_call_id,
            (voteRef) => getRollCallCached(voteRef.roll_call_id)
          );

          for (const { item: voteRef, result: rcResult } of rollCallResults) {
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
          roll_call_coverage,
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
    "Get only bills where a legislator is the PRIMARY author (sponsor_type_id=PrimarySponsor), not co-sponsor. Use find_legislator first to get people_id from a name. Pass state or session_id when you want results scoped to a specific legislature and timeframe; otherwise this returns all available sessions for that legislator. Fetches a page of at most limit sponsored bills (default 100); use next_offset to inspect the remainder.",
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
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .default(100)
        .describe(
          "Max sponsored bills to fetch and check (default 100). Lower values reduce API quota usage."
        ),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .default(0)
        .describe("Number of sponsored bills to skip when continuing a search"),
    },
    async ({ people_id, session_id, state, limit, offset }) => {
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

        const billsToProcess = filteredBills.slice(offset, offset + limit);
        const nextOffset = offset + billsToProcess.length;

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
        // Fetch all bill details in batches to avoid rate limits
        const billResults = await processUniqueBatched(
          billsToProcess,
          (billInfo) => billInfo.bill_id,
          (billInfo) => client.getBill(billInfo.bill_id)
        );

        for (const { item: billInfo, result } of billResults) {
          if (result.status === "rejected") {
            errors.push(`Bill ${billInfo.bill_id}: ${formatError(result.reason)}`);
            continue;
          }

          const bill = result.value;

          // Find this legislator's sponsorship
          const sponsor = bill.sponsors.find((s) => s.people_id === people_id);

          if (sponsor && isPrimaryAuthor(sponsor)) {
            if (!legislatorName) legislatorName = sponsor.name;

            primaryAuthored.push({
              bill_id: bill.bill_id,
              bill_number: bill.bill_number,
              title: bill.title,
              description: bill.description,
              session_id: bill.session_id,
              status: bill.status.toString(),
              status_date: bill.status_date,
              sponsor_order: sponsor.sponsor_order,
              sponsor_type: SPONSOR_TYPE_NAMES[sponsor.sponsor_type_id] || "Unknown",
            });
          }
        }

        return jsonResponse({
          legislator: {
            people_id,
            name: legislatorName || `Legislator ${people_id}`,
          },
          scope,
          limit,
          offset,
          next_offset: nextOffset < filteredBills.length ? nextOffset : undefined,
          truncated: nextOffset < filteredBills.length || undefined,
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
