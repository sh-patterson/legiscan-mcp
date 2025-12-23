// Bill-related MCP tools

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LegiScanClient } from "../legiscan-client.js";
import { jsonResponse, errorResponse } from "./helpers.js";

export function registerBillTools(server: McpServer, client: LegiScanClient) {
  // Get Bill Details
  server.tool(
    "legiscan_get_bill",
    "Get detailed bill information including sponsors, full history, votes, texts, amendments, and supplements. This is the primary tool for bill research.",
    {
      bill_id: z.number().describe("Bill ID from search results or find_bill_by_number"),
    },
    async ({ bill_id }) => {
      try {
        const bill = await client.getBill(bill_id);
        return jsonResponse(bill);
      } catch (error) {
        return errorResponse(error);
      }
    }
  );

  // Get Roll Call
  server.tool(
    "legiscan_get_roll_call",
    "Get roll call vote details including individual legislator votes. Use roll_call_id from bill.votes[] array.",
    {
      roll_call_id: z.number().describe("Roll call ID from bill.votes[] array"),
    },
    async ({ roll_call_id }) => {
      try {
        const rollCall = await client.getRollCall(roll_call_id);
        return jsonResponse(rollCall);
      } catch (error) {
        return errorResponse(error);
      }
    }
  );

  // Find Bill by Number
  server.tool(
    "legiscan_find_bill_by_number",
    "Find a bill by its number within a state's current session or specific session. Handles format variations (AB 858, AB858, AB-858). Returns bill summary if found, null if not.",
    {
      state: z
        .string()
        .optional()
        .describe("Two-letter state abbreviation (e.g., CA, TX). Uses current session."),
      session_id: z
        .number()
        .optional()
        .describe(
          "Session ID for searching a specific session. Takes precedence over state."
        ),
      bill_number: z
        .string()
        .describe(
          "Bill number in any common format (e.g., 'AB 858', 'AB858', 'AB-858', 'SB 1234')"
        ),
    },
    async ({ state, session_id, bill_number }) => {
      try {
        if (!session_id && !state) {
          return errorResponse("Either session_id or state is required");
        }

        const result = session_id
          ? await client.findBillByNumberInSession(session_id, bill_number)
          : await client.findBillByNumber(state!, bill_number);

        if (result) {
          return jsonResponse(result);
        }
        return jsonResponse({
          found: false,
          message: `Bill '${bill_number}' not found in ${session_id ? `session ${session_id}` : `${state} current session`}`,
        });
      } catch (error) {
        return errorResponse(error);
      }
    }
  );
}
