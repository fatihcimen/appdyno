const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** A JWT of `header` and `claims`, signed by `sign` over the two as RFC 7519 joins them. */
export function jwtOf(header: object, claims: object, sign: (signed: Buffer) => Buffer): string {
  const signed = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  return `${signed}.${b64url(sign(Buffer.from(signed)))}`;
}

/**
 * One issuer's tokens, each kept by its key's id for `ttlMs` from when it was made, and made again by `make` only once
 * that has passed: each issuer has a cache of its own, as each has its own lifetime.
 */
export function jwtCache(ttlMs: number) {
  const kept = new Map<string, { jwt: string; at: number }>();
  return (id: string, now: number, make: () => string) => {
    const k = kept.get(id);
    if (k && now - k.at < ttlMs) return k.jwt;
    const jwt = make();
    kept.set(id, { jwt, at: now });
    return jwt;
  };
}
