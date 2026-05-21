import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createConnectedClient } from "./mcp-test-helpers.js";

describe("server instructions and tool descriptions", () => {
  let client: Client;
  let instructions: string | undefined;
  let tools: Array<{
    name: string;
    description?: string;
    inputSchema: { properties?: Record<string, object> };
  }>;

  beforeAll(async () => {
    client = await createConnectedClient();
    instructions = client.getInstructions();
    const result = await client.listTools();
    tools = result.tools;
  });

  afterAll(async () => {
    await client.close();
  });

  // --- Instructions ---

  it("provides non-empty instructions", () => {
    expect(instructions).toBeTruthy();
    expect(typeof instructions).toBe("string");
    expect(instructions!.length).toBeGreaterThan(0);
  });

  it("instructions say never ask users for internal IDs", () => {
    expect(instructions!.toLowerCase()).toContain("never");
    expect(instructions!).toMatch(/people_id|bill_id|session_id|roll_call_id/);
  });

  it("instructions reference find_legislator as a resolver", () => {
    expect(instructions).toContain("find_legislator");
  });

  it("instructions reference find_bill_by_number as a resolver", () => {
    expect(instructions).toContain("find_bill_by_number");
  });

  // --- Tool count ---

  it("registers all 10 tools", () => {
    expect(tools).toHaveLength(10);
  });

  // --- De-jargoned descriptions ---

  it("no tool description contains bill.votes[]", () => {
    for (const tool of tools) {
      const desc = tool.description ?? "";
      const paramDescs = Object.values(tool.inputSchema.properties ?? {})
        .map((p) => (p as { description?: string }).description ?? "")
        .join(" ");
      const combined = `${desc} ${paramDescs}`;
      expect(combined).not.toContain("bill.votes[]");
    }
  });

  it("tools needing people_id mention find_legislator in their description", () => {
    const toolsWithPeopleId = tools.filter((t) => {
      const props = t.inputSchema.properties ?? {};
      return "people_id" in props;
    });

    expect(toolsWithPeopleId.length).toBeGreaterThan(0);

    for (const tool of toolsWithPeopleId) {
      const desc = tool.description ?? "";
      const paramDescs = Object.values(tool.inputSchema.properties ?? {})
        .map((p) => (p as { description?: string }).description ?? "")
        .join(" ");
      const combined = `${desc} ${paramDescs}`;
      expect(combined).toContain("find_legislator");
    }
  });

  it("get_session_people mentions get_session_list in its description", () => {
    const tool = tools.find((t) => t.name === "legiscan_get_session_people");
    expect(tool).toBeDefined();

    const desc = tool!.description ?? "";
    const paramDescs = Object.values(tool!.inputSchema.properties ?? {})
      .map((p) => (p as { description?: string }).description ?? "")
      .join(" ");
    const combined = `${desc} ${paramDescs}`;
    expect(combined).toContain("get_session_list");
  });
});
