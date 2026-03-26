import crypto from 'crypto';

/** Timing-safe SHA-256 HMAC comparison. Returns true if signature is valid. */
export function validateHmac(rawBody: string, signature: string, appSecret: string): boolean {
  const expectedSig =
    'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  // Pad to equal length before timing-safe comparison to avoid length oracle
  const sigBuffer = Buffer.from(signature.padEnd(expectedSig.length));
  const expectedBuffer = Buffer.from(expectedSig.padEnd(signature.length));
  // Use longer of the two for final comparison
  const a = signature.length >= expectedSig.length ? sigBuffer : Buffer.from(signature);
  const b = signature.length >= expectedSig.length ? expectedBuffer : Buffer.from(expectedSig);
  return signature.length === expectedSig.length && crypto.timingSafeEqual(a, b);
}
