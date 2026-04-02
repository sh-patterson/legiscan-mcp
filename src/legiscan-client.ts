// LegiScan API Client
// Typed wrapper for the LegiScan Pull API

import type {
  Session,
  Bill,
  Person,
  RollCall,
  BillText,
  Amendment,
  Supplement,
  MasterListItem,
  MasterListRawItem,
  SearchResultItem,
  SearchSummary,
  SearchRawResultItem,
  Dataset,
  DatasetArchive,
  MonitorListItem,
  MonitorListRawItem,
  SessionPeople,
  SponsoredBillItem,
  SponsoredBills,
  SessionListResponse,
  MasterListResponse,
  MasterListRawResponse,
  BillResponse,
  BillTextResponse,
  AmendmentResponse,
  SupplementResponse,
  RollCallResponse,
  PersonResponse,
  SearchResponse,
  SearchRawResponse,
  DatasetListResponse,
  DatasetResponse,
  SessionPeopleResponse,
  SponsoredListResponse,
  MonitorListResponse,
  MonitorListRawResponse,
  SetMonitorResponse,
  BaseResponse,
} from "./types/legiscan.js";
import { canonicalizeBillSearchQuery, normalizeBillNumber } from "./tools/helpers.js";

const API_BASE_URL = "https://api.legiscan.com/";
const REQUEST_TIMEOUT_MS = 30000; // 30 seconds

export class LegiScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegiScanError";
  }
}

export interface SearchParams {
  state?: string;
  query: string;
  year?: number;
  page?: number;
  session_id?: number;
}

export interface SetMonitorParams {
  list: string; // Comma-separated bill_ids
  action: "monitor" | "remove" | "set";
  stance?: "watch" | "support" | "oppose";
}

export class LegiScanClient {
  private apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new LegiScanError("LegiScan API key is required");
    }
    this.apiKey = apiKey;
  }

  private async request<T extends BaseResponse>(
    operation: string,
    params: Record<string, string | number | undefined> = {}
  ): Promise<T> {
    const url = new URL(API_BASE_URL);
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set("op", operation);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url.toString(), {
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new LegiScanError(`HTTP error ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as T;

      if (data.status === "ERROR") {
        throw new LegiScanError(data.alert?.message || "Unknown API error");
      }

      return data;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new LegiScanError(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      }
      if (error instanceof LegiScanError) {
        throw error;
      }
      throw new LegiScanError(
        `Network error: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ============================================
  // Session Operations
  // ============================================

  /**
   * Get list of available sessions for a state or all states
   * @param state Optional state abbreviation (e.g., "CA", "TX")
   */
  async getSessionList(state?: string): Promise<Session[]> {
    const response = await this.request<SessionListResponse>("getSessionList", {
      state,
    });
    return response.sessions;
  }

  // ============================================
  // Bill Operations
  // ============================================

  /**
   * Get master list of bills for a session
   * @param params Either session_id or state (for current session)
   */
  async getMasterList(params: {
    id?: number;
    state?: string;
  }): Promise<MasterListItem[]> {
    const response = await this.request<MasterListResponse>("getMasterList", params);
    // Convert object to array, filtering to only bill entries (have bill_id)
    return Object.values(response.masterlist).filter(
      (item): item is MasterListItem =>
        item !== null && typeof item === "object" && "bill_id" in item
    );
  }

  /**
   * Get optimized master list with only bill_id, number, and change_hash
   * @param params Either session_id or state (for current session)
   */
  async getMasterListRaw(params: {
    id?: number;
    state?: string;
  }): Promise<MasterListRawItem[]> {
    const response = await this.request<MasterListRawResponse>(
      "getMasterListRaw",
      params
    );
    // Filter to only bill entries (have bill_id)
    return Object.values(response.masterlist).filter(
      (item): item is MasterListRawItem =>
        item !== null && typeof item === "object" && "bill_id" in item
    );
  }

  /**
   * Get detailed bill information
   * @param billId The bill_id to retrieve
   */
  async getBill(billId: number): Promise<Bill> {
    const response = await this.request<BillResponse>("getBill", {
      id: billId,
    });
    return response.bill;
  }

  /**
   * Get bill text document (base64 encoded)
   * @param docId The doc_id from bill.texts[]
   */
  async getBillText(docId: number): Promise<BillText> {
    const response = await this.request<BillTextResponse>("getBillText", {
      id: docId,
    });
    return response.text;
  }

  /**
   * Get amendment document (base64 encoded)
   * @param amendmentId The amendment_id from bill.amendments[]
   */
  async getAmendment(amendmentId: number): Promise<Amendment> {
    const response = await this.request<AmendmentResponse>("getAmendment", {
      id: amendmentId,
    });
    return response.amendment;
  }

  /**
   * Get supplemental document (base64 encoded)
   * @param supplementId The supplement_id from bill.supplements[]
   */
  async getSupplement(supplementId: number): Promise<Supplement> {
    const response = await this.request<SupplementResponse>("getSupplement", {
      id: supplementId,
    });
    return response.supplement;
  }

  // ============================================
  // Vote Operations
  // ============================================

  /**
   * Get roll call vote details with individual votes
   * @param rollCallId The roll_call_id from bill.votes[]
   */
  async getRollCall(rollCallId: number): Promise<RollCall> {
    const response = await this.request<RollCallResponse>("getRollCall", {
      id: rollCallId,
    });
    return response.roll_call;
  }

  // ============================================
  // Person Operations
  // ============================================

  /**
   * Get legislator information
   * @param peopleId The people_id to retrieve
   */
  async getPerson(peopleId: number): Promise<Person> {
    const response = await this.request<PersonResponse>("getPerson", {
      id: peopleId,
    });
    return response.person;
  }

  /**
   * Get all legislators active in a session
   * @param sessionId The session_id to retrieve people for
   */
  async getSessionPeople(sessionId: number): Promise<SessionPeople> {
    const response = await this.request<SessionPeopleResponse>("getSessionPeople", {
      id: sessionId,
    });
    return response.sessionpeople;
  }

  /**
   * Get list of bills sponsored by a legislator
   * @param peopleId The people_id to get sponsored bills for
   */
  async getSponsoredList(peopleId: number): Promise<SponsoredBillItem[]> {
    const response = await this.request<SponsoredListResponse>("getSponsoredList", {
      id: peopleId,
    });
    return response.sponsoredbills.bills;
  }

  /**
   * Get full sponsored list response including sponsor info and sessions
   * @param peopleId The people_id to get sponsored bills for
   */
  async getSponsoredListFull(peopleId: number): Promise<SponsoredBills> {
    const response = await this.request<SponsoredListResponse>("getSponsoredList", {
      id: peopleId,
    });
    return response.sponsoredbills;
  }

  /**
   * Find a bill by its number within a state's current session
   * Handles variations like "AB 858", "AB858", "AB-858", "ab858"
   * @param state State abbreviation (e.g., "CA", "TX")
   * @param billNumber Bill number in any common format
   */
  async findBillByNumber(
    state: string,
    billNumber: string
  ): Promise<MasterListItem | null> {
    const masterList = await this.getMasterList({ state });
    const normalizedQuery = normalizeBillNumber(billNumber);

    for (const item of masterList) {
      if (normalizeBillNumber(item.number) === normalizedQuery) {
        return item;
      }
    }
    return null;
  }

  /**
   * Find bills by number within a specific session
   * Handles variations like "AB 858", "AB858", "AB-858", "ab858"
   * @param sessionId The session_id to search within
   * @param billNumber Bill number in any common format
   */
  async findBillByNumberInSession(
    sessionId: number,
    billNumber: string
  ): Promise<MasterListItem | null> {
    const masterList = await this.getMasterList({ id: sessionId });
    const normalizedQuery = normalizeBillNumber(billNumber);

    for (const item of masterList) {
      if (normalizeBillNumber(item.number) === normalizedQuery) {
        return item;
      }
    }
    return null;
  }

  // ============================================
  // Search Operations
  // ============================================

  /**
   * Full-text search (50 results per page)
   * @param params Search parameters
   */
  async getSearch(params: SearchParams): Promise<{
    summary: SearchSummary;
    results: SearchResultItem[];
  }> {
    const primaryResponse = await this.request<SearchResponse>(
      "getSearch",
      this.buildSearchParams(params)
    );
    const primaryResult = this.parseSearchResponse(primaryResponse);

    const canonicalQuery = this.getCanonicalBillSearchRetryQuery(
      params.query,
      primaryResult.results,
      (item) => item.bill_number
    );

    if (!canonicalQuery) {
      return primaryResult;
    }

    const fallbackResponse = await this.request<SearchResponse>(
      "getSearch",
      this.buildSearchParams({ ...params, query: canonicalQuery })
    );

    const fallbackResult = this.parseSearchResponse(fallbackResponse);

    return fallbackResult.results.length > 0 ? fallbackResult : primaryResult;
  }

  /**
   * Full-text search (2000 results per page)
   * @param params Search parameters
   */
  async getSearchRaw(params: SearchParams): Promise<{
    summary: SearchSummary;
    results: SearchRawResultItem[];
  }> {
    const searchParams = this.buildSearchParams(params);
    const initialCanonicalQuery = canonicalizeBillSearchQuery(params.query);
    const primaryResponse = await this.request<SearchRawResponse>(
      "getSearchRaw",
      searchParams
    );
    const primaryResult = {
      summary: primaryResponse.searchresult.summary,
      results: primaryResponse.searchresult.results,
    };

    if (initialCanonicalQuery === null || initialCanonicalQuery === params.query) {
      return primaryResult;
    }

    let canonicalQuery = this.getCanonicalBillSearchRetryQuery(params.query, []);

    if (primaryResult.results.length > 0) {
      canonicalQuery = await this.getCanonicalBillSearchRetryQueryFromParsedSearch(
        params,
        searchParams
      );
    }

    if (!canonicalQuery) {
      return primaryResult;
    }

    const fallbackResponse = await this.request<SearchRawResponse>(
      "getSearchRaw",
      this.buildSearchParams({ ...params, query: canonicalQuery })
    );

    const fallbackResult = {
      summary: fallbackResponse.searchresult.summary,
      results: fallbackResponse.searchresult.results,
    };

    return fallbackResult.results.length > 0 ? fallbackResult : primaryResult;
  }

  private buildSearchParams(
    params: SearchParams
  ): Record<string, string | number | undefined> {
    const apiParams: Record<string, string | number | undefined> = {
      query: params.query,
      page: params.page,
    };

    if (params.session_id) {
      apiParams.id = params.session_id;
    } else {
      apiParams.state = params.state || "ALL";
      apiParams.year = params.year;
    }

    return apiParams;
  }

  private parseSearchResponse(response: SearchResponse): {
    summary: SearchSummary;
    results: SearchResultItem[];
  } {
    const results: SearchResultItem[] = [];
    for (const [key, value] of Object.entries(response.searchresult)) {
      if (
        key !== "summary" &&
        value !== null &&
        typeof value === "object" &&
        "bill_id" in value
      ) {
        results.push(value as SearchResultItem);
      }
    }

    return {
      summary: response.searchresult.summary as SearchSummary,
      results,
    };
  }

  private async getCanonicalBillSearchRetryQueryFromParsedSearch(
    params: SearchParams,
    searchParams: Record<string, string | number | undefined>
  ): Promise<string | null> {
    try {
      const verificationResponse = await this.request<SearchResponse>(
        "getSearch",
        searchParams
      );
      const verificationResult = this.parseSearchResponse(verificationResponse);

      return this.getCanonicalBillSearchRetryQuery(
        params.query,
        verificationResult.results,
        (item) => item.bill_number
      );
    } catch {
      return null;
    }
  }

  private getCanonicalBillSearchRetryQuery<T>(
    query: string,
    results: T[],
    getBillNumber?: (item: T) => string | undefined
  ): string | null {
    const canonicalQuery = canonicalizeBillSearchQuery(query);

    if (canonicalQuery === null || canonicalQuery === query) {
      return null;
    }

    if (results.length === 0) {
      return canonicalQuery;
    }

    if (!getBillNumber) {
      return canonicalQuery;
    }

    const normalizedQuery = normalizeBillNumber(query);
    const hasExactMatch = results.some((item) => {
      const billNumber = getBillNumber(item);
      return (
        billNumber !== undefined && normalizeBillNumber(billNumber) === normalizedQuery
      );
    });

    return hasExactMatch ? null : canonicalQuery;
  }

  // ============================================
  // Dataset Operations
  // ============================================

  /**
   * Get list of available datasets
   * @param params Optional filters for state and/or year
   */
  async getDatasetList(params?: { state?: string; year?: number }): Promise<Dataset[]> {
    const response = await this.request<DatasetListResponse>("getDatasetList", params);
    return response.datasetlist;
  }

  /**
   * Get dataset ZIP archive (base64 encoded)
   * @param sessionId The session_id to download
   * @param accessKey The access_key from getDatasetList
   * @param format Optional format: "json" (default) or "csv"
   */
  async getDataset(
    sessionId: number,
    accessKey: string,
    format?: "json" | "csv"
  ): Promise<DatasetArchive> {
    const response = await this.request<DatasetResponse>("getDataset", {
      id: sessionId,
      access_key: accessKey,
      format,
    });
    return response.dataset;
  }

  // ============================================
  // Monitor Operations (GAITS)
  // ============================================

  /**
   * Get GAITS monitor list
   * @param record Optional: "current" (default), "archived", or year >= 2010
   */
  async getMonitorList(record?: string): Promise<MonitorListItem[]> {
    const response = await this.request<MonitorListResponse>("getMonitorList", {
      record,
    });
    return Object.values(response.monitorlist);
  }

  /**
   * Get GAITS monitor list (minimal data for change detection)
   * @param record Optional: "current" (default), "archived", or year >= 2010
   */
  async getMonitorListRaw(record?: string): Promise<MonitorListRawItem[]> {
    const response = await this.request<MonitorListRawResponse>("getMonitorListRaw", {
      record,
    });
    return Object.values(response.monitorlist);
  }

  /**
   * Add/remove bills from GAITS monitor list
   * @param params Monitor operation parameters
   */
  async setMonitor(params: SetMonitorParams): Promise<Record<string, string>> {
    const response = await this.request<SetMonitorResponse>("setMonitor", {
      list: params.list,
      action: params.action,
      stance: params.stance,
    });
    return response.return;
  }
}
