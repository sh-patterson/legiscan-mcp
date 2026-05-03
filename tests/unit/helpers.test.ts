import { describe, expect, it } from "vitest";

import {
  canonicalizeBillSearchQuery,
  normalizeBillNumber,
  searchStateSchema,
  stateCodeSchema,
} from "../../src/tools/helpers.js";

describe("normalizeBillNumber", () => {
  it("normalizes common bill number formats", () => {
    expect(normalizeBillNumber("AB 858")).toBe("AB858");
    expect(normalizeBillNumber("ab-858")).toBe("AB858");
    expect(normalizeBillNumber("SB.0012")).toBe("SB12");
  });
});

describe("canonicalizeBillSearchQuery", () => {
  it("converts bill number variants to a spaced canonical form", () => {
    expect(canonicalizeBillSearchQuery("AB858")).toBe("AB 858");
    expect(canonicalizeBillSearchQuery("A.B. 0858")).toBe("AB 858");
    expect(canonicalizeBillSearchQuery("sb-12a")).toBe("SB 12A");
  });

  it("preserves embedded session markers and hyphenated bill identifiers", () => {
    expect(canonicalizeBillSearchQuery("ABX21")).toBe("ABX2 1");
    expect(canonicalizeBillSearchQuery("ABX2-1")).toBe("ABX2 1");
    expect(canonicalizeBillSearchQuery("HB24-1234")).toBe("HB 24-1234");
    expect(canonicalizeBillSearchQuery("HB24-01234")).toBe("HB 24-1234");
  });

  it("returns null for non-bill queries", () => {
    expect(canonicalizeBillSearchQuery("housing affordability")).toBeNull();
  });
});

describe("state schemas", () => {
  it("normalizes two-letter state abbreviations", () => {
    expect(stateCodeSchema.parse("ca")).toBe("CA");
  });

  it("rejects invalid two-letter state abbreviations", () => {
    expect(() => stateCodeSchema.parse("CAL")).toThrow(
      "State must be a two-letter abbreviation"
    );
  });

  it("accepts ALL for search state", () => {
    expect(searchStateSchema.parse("all")).toBe("ALL");
  });
});
