import { hmacSha256Hex } from '../crypto'

/** Binance HMAC-SHA256 signature over the exact query string (docs: "SIGNED Endpoint Security"). */
export function signBinance(queryString: string, secret: string): string {
  return hmacSha256Hex(secret, queryString)
}

/** Build the query string in insertion order (order matters for the signature). */
export function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined) sp.append(k, String(v))
  return sp.toString()
}
