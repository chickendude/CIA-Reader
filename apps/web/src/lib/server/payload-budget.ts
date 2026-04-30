export const MOBILE_RESPONSE_BUDGET_BYTES = 100 * 1024;

const encoder = new TextEncoder();

export function jsonPayloadBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

export function withinMobileResponseBudget(value: unknown): boolean {
  return jsonPayloadBytes(value) <= MOBILE_RESPONSE_BUDGET_BYTES;
}
