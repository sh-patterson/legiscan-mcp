import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LegiScanClient, LegiScanError } from "../../src/legiscan-client.js";

const TEST_API_KEY = "test-api-key";

function jsonResponse(data: unknown, init: Partial<Response> = {}): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => data,
    ...init,
  } as Response;
}

describe("LegiScanClient (unit)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it("throws when API key is missing", () => {
    expect(() => new LegiScanClient("")).toThrow(LegiScanError);
  });

  it("uses session_id as id param for session-scoped search", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: "OK",
        searchresult: {
          summary: {
            page: "1",
            range: "1-1",
            relevancy: "100%",
            count: 0,
            page_current: 1,
            page_total: 1,
          },
        },
      })
    );

    const client = new LegiScanClient(TEST_API_KEY);
    await client.getSearch({ query: "tax", session_id: 2172 });

    const [calledUrl] = fetchMock.mock.calls[0];
    const url = new URL(String(calledUrl));

    expect(url.searchParams.get("op")).toBe("getSearch");
    expect(url.searchParams.get("id")).toBe("2172");
    expect(url.searchParams.get("state")).toBeNull();
    expect(url.searchParams.get("year")).toBeNull();
  });

  it("uses state/year params for standard search", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: "OK",
        searchresult: {
          summary: {
            page: "1",
            range: "1-1",
            relevancy: "100%",
            count: 1,
            page_current: 1,
            page_total: 1,
          },
          "0": {
            relevance: 99,
            state: "CA",
            bill_number: "AB 1",
            bill_id: 1,
            change_hash: "abc",
            url: "https://example.com",
            text_url: "https://example.com/text",
            research_url: "https://example.com/research",
            last_action_date: "2026-01-01",
            last_action: "Introduced",
            title: "Test Bill",
          },
        },
      })
    );

    const client = new LegiScanClient(TEST_API_KEY);
    const result = await client.getSearch({
      query: "education",
      state: "CA",
      year: 2,
      page: 3,
    });

    const [calledUrl] = fetchMock.mock.calls[0];
    const url = new URL(String(calledUrl));

    expect(url.searchParams.get("state")).toBe("CA");
    expect(url.searchParams.get("year")).toBe("2");
    expect(url.searchParams.get("page")).toBe("3");
    expect(url.searchParams.get("id")).toBeNull();
    expect(result.results).toHaveLength(1);
  });

  it("retries bill-number searches with a canonical spaced query when needed", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          status: "OK",
          searchresult: {
            summary: {
              page: "1",
              range: "1-0",
              relevancy: "0%",
              count: 0,
              page_current: 1,
              page_total: 1,
            },
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "OK",
          searchresult: {
            summary: {
              page: "1",
              range: "1-1",
              relevancy: "100%",
              count: 1,
              page_current: 1,
              page_total: 1,
            },
            "0": {
              relevance: 99,
              state: "CA",
              bill_number: "AB 858",
              bill_id: 858,
              change_hash: "abc",
              url: "https://example.com",
              text_url: "https://example.com/text",
              research_url: "https://example.com/research",
              last_action_date: "2026-01-01",
              last_action: "Introduced",
              title: "Test Bill",
            },
          },
        })
      );

    const client = new LegiScanClient(TEST_API_KEY);
    const result = await client.getSearch({
      query: "AB858",
      state: "CA",
      year: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstUrl = new URL(String(fetchMock.mock.calls[0][0]));
    const secondUrl = new URL(String(fetchMock.mock.calls[1][0]));

    expect(firstUrl.searchParams.get("query")).toBe("AB858");
    expect(secondUrl.searchParams.get("query")).toBe("AB 858");
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.bill_id).toBe(858);
  });

  it("retries session-scoped bill-number searches with a canonical spaced query", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          status: "OK",
          searchresult: {
            summary: {
              page: "1",
              range: "1-0",
              relevancy: "0%",
              count: 0,
              page_current: 1,
              page_total: 1,
            },
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "OK",
          searchresult: {
            summary: {
              page: "1",
              range: "1-1",
              relevancy: "100%",
              count: 1,
              page_current: 1,
              page_total: 1,
            },
            "0": {
              relevance: 99,
              state: "CA",
              bill_number: "AB 858",
              bill_id: 858,
              change_hash: "abc",
              url: "https://example.com",
              text_url: "https://example.com/text",
              research_url: "https://example.com/research",
              last_action_date: "2026-01-01",
              last_action: "Introduced",
              title: "Test Bill",
            },
          },
        })
      );

    const client = new LegiScanClient(TEST_API_KEY);
    const result = await client.getSearch({ query: "AB858", session_id: 2172 });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstUrl = new URL(String(fetchMock.mock.calls[0][0]));
    const secondUrl = new URL(String(fetchMock.mock.calls[1][0]));

    expect(firstUrl.searchParams.get("query")).toBe("AB858");
    expect(secondUrl.searchParams.get("query")).toBe("AB 858");
    expect(firstUrl.searchParams.get("id")).toBe("2172");
    expect(secondUrl.searchParams.get("id")).toBe("2172");
    expect(result.results[0]?.bill_id).toBe(858);
  });

  it("preserves special-session markers in bill-number retry queries", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          status: "OK",
          searchresult: {
            summary: {
              page: "1",
              range: "1-0",
              relevancy: "0%",
              count: 0,
              page_current: 1,
              page_total: 1,
            },
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "OK",
          searchresult: {
            summary: {
              page: "1",
              range: "1-1",
              relevancy: "100%",
              count: 1,
              page_current: 1,
              page_total: 1,
            },
            "0": {
              relevance: 99,
              state: "CA",
              bill_number: "ABX2 1",
              bill_id: 21,
              change_hash: "abc",
              url: "https://example.com",
              text_url: "https://example.com/text",
              research_url: "https://example.com/research",
              last_action_date: "2026-01-01",
              last_action: "Introduced",
              title: "Special session bill",
            },
          },
        })
      );

    const client = new LegiScanClient(TEST_API_KEY);
    const result = await client.getSearch({ query: "ABX21", session_id: 2172 });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstUrl = new URL(String(fetchMock.mock.calls[0][0]));
    const secondUrl = new URL(String(fetchMock.mock.calls[1][0]));

    expect(firstUrl.searchParams.get("query")).toBe("ABX21");
    expect(secondUrl.searchParams.get("query")).toBe("ABX2 1");
    expect(result.results[0]?.bill_id).toBe(21);
  });

  it("retries raw bill-number searches with a canonical spaced query", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          status: "OK",
          searchresult: {
            summary: {
              page: "1",
              range: "1-0",
              relevancy: "0%",
              count: 0,
              page_current: 1,
              page_total: 1,
            },
            results: [],
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "OK",
          searchresult: {
            summary: {
              page: "1",
              range: "1-1",
              relevancy: "100%",
              count: 1,
              page_current: 1,
              page_total: 1,
            },
            results: [
              {
                relevance: 99,
                bill_id: 858,
                change_hash: "abc",
              },
            ],
          },
        })
      );

    const client = new LegiScanClient(TEST_API_KEY);
    const result = await client.getSearchRaw({ query: "AB858", session_id: 2172 });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstUrl = new URL(String(fetchMock.mock.calls[0][0]));
    const secondUrl = new URL(String(fetchMock.mock.calls[1][0]));

    expect(firstUrl.searchParams.get("query")).toBe("AB858");
    expect(secondUrl.searchParams.get("query")).toBe("AB 858");
    expect(result.results[0]?.bill_id).toBe(858);
  });

  it("filters non-bill entries from master list", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: "OK",
        masterlist: {
          session: {
            session_id: 2172,
          },
          "123": {
            bill_id: 123,
            number: "AB 123",
            change_hash: "hash",
            url: "https://example.com",
            status_date: "2026-01-01",
            status: "1",
            last_action_date: "2026-01-01",
            last_action: "Introduced",
            title: "Bill 123",
            description: "Desc",
          },
          empty: null,
        },
      })
    );

    const client = new LegiScanClient(TEST_API_KEY);
    const bills = await client.getMasterList({ state: "CA" });

    expect(bills).toHaveLength(1);
    expect(bills[0]?.bill_id).toBe(123);
  });

  it("throws LegiScanError for HTTP failures", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      jsonResponse({}, { ok: false, status: 500, statusText: "Internal Server Error" })
    );

    const client = new LegiScanClient(TEST_API_KEY);

    await expect(client.getSessionList("CA")).rejects.toThrow(
      "HTTP error 500: Internal Server Error"
    );
  });

  it("throws LegiScanError for API-level errors", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: "ERROR",
        alert: {
          message: "Bad request",
        },
      })
    );

    const client = new LegiScanClient(TEST_API_KEY);

    await expect(client.getSessionList("ZZ")).rejects.toThrow("Bad request");
  });

  it("wraps network failures as LegiScanError", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValue(new Error("socket hang up"));

    const client = new LegiScanClient(TEST_API_KEY);

    await expect(client.getSessionList("CA")).rejects.toThrow(
      "Network error: socket hang up"
    );
  });
});
