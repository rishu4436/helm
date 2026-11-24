import { hmacSha256Base64 } from '../crypto'

/**
 * OKX v5 REST signature: Base64(HMAC-SHA256(timestamp + METHOD + requestPath + body, secret)).
 * requestPath includes the query string for GET; body is the exact JSON string for POST.
 * timestamp is ISO-8601 with milliseconds, e.g. 2020-12-08T09:08:57.715Z.
 */
export function signOkx(timestamp: string, method: string, requestPath: string, body: string, secret: string): string {
  return hmacSha256Base64(secret, `${timestamp}${method.toUpperCase()}${requestPath}${body}`)
}
