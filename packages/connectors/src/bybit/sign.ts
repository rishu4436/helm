import { hmacSha256Hex } from '../crypto'

/**
 * Bybit V5 HMAC signature: hex(HMAC_SHA256(timestamp + apiKey + recvWindow + payload)).
 * payload = raw query string for GET, raw JSON body for POST.
 */
export function signBybit(timestamp: string, apiKey: string, recvWindow: string, payload: string, secret: string): string {
  return hmacSha256Hex(secret, `${timestamp}${apiKey}${recvWindow}${payload}`)
}
