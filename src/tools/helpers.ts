// Shared helpers for MCP tool handlers
import { z } from "zod";

/**
 * Normalize a bill number for comparison
 * Handles variations like "AB 858", "AB858", "AB-858", "ab858"
 */
export function normalizeBillNumber(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s.-]/g, "") // Remove spaces, dots, dashes
    .replace(/^([A-Z]+)0+(\d)/, "$1$2"); // Strip leading zeros: AB0858 → AB858
}

function stripLeadingZeros(token: string): string {
  const match = token.match(/^0*(\d+)([A-Z]?)$/);

  if (!match) {
    return token;
  }

  return `${match[1]}${match[2]}`;
}

/**
 * Canonicalize bill-number-like search queries to the format the
 * LegiScan search endpoint handles most reliably (e.g. "AB 858").
 * Returns null when the query does not look like a bill number.
 */
export function canonicalizeBillSearchQuery(input: string): string | null {
  const compact = input.toUpperCase().trim().replace(/[.\s]/g, "");

  if (!/^[A-Z0-9-]+$/.test(compact)) {
    return null;
  }

  const specialSessionMatch = compact.match(/^([A-Z]+X\d)(\d+[A-Z]?)$/);
  if (specialSessionMatch) {
    return `${specialSessionMatch[1]} ${stripLeadingZeros(specialSessionMatch[2])}`;
  }

  const hyphenatedSpecialSessionMatch = compact.match(/^([A-Z]+X\d)-(\d+[A-Z]?)$/);
  if (hyphenatedSpecialSessionMatch) {
    return `${hyphenatedSpecialSessionMatch[1]} ${stripLeadingZeros(hyphenatedSpecialSessionMatch[2])}`;
  }

  const prefixedHyphenMatch = compact.match(/^([A-Z]+)-(\d+[A-Z]?)$/);
  if (prefixedHyphenMatch) {
    return `${prefixedHyphenMatch[1]} ${stripLeadingZeros(prefixedHyphenMatch[2])}`;
  }

  const hyphenatedMatch = compact.match(/^([A-Z]+)(\d+-\d+[A-Z]?)$/);
  if (hyphenatedMatch) {
    const [firstSegment, secondSegment] = hyphenatedMatch[2].split("-");
    return `${hyphenatedMatch[1]} ${stripLeadingZeros(firstSegment)}-${stripLeadingZeros(secondSegment)}`;
  }

  const match = compact.match(/^([A-Z]+)(\d+[A-Z]?)$/);

  if (!match) {
    return null;
  }

  return `${match[1]} ${stripLeadingZeros(match[2])}`;
}

export const stateCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, "State must be a two-letter abbreviation")
  .transform((value) => value.toUpperCase());

export const searchStateSchema = z
  .string()
  .trim()
  .regex(/^(?:[A-Za-z]{2}|[Aa][Ll][Ll])$/, "State must be two-letter code or ALL")
  .transform((value) => value.toUpperCase());

/**
 * Create a successful JSON tool response
 */
export function jsonResponse(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

/**
 * Create an error tool response
 */
export function errorResponse(error: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
      },
    ],
    isError: true,
  };
}
