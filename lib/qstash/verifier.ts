import { Receiver } from '@upstash/qstash';

let receiverInstance: Receiver | null = null;

function getReceiver(): Receiver {
  if (!receiverInstance) {
    const currentKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
    const nextKey = process.env.QSTASH_NEXT_SIGNING_KEY;

    if (!currentKey || !nextKey) {
      throw new Error(
        'Missing QSTASH_CURRENT_SIGNING_KEY or QSTASH_NEXT_SIGNING_KEY environment variables'
      );
    }

    receiverInstance = new Receiver({
      currentSigningKey: currentKey,
      nextSigningKey: nextKey,
    });
  }
  return receiverInstance;
}

/**
 * Verifies the QStash signature on an incoming worker request.
 *
 * QStash signs every delivery with HMAC-SHA256. This verifier checks both
 * the current and next signing keys (for zero-downtime key rotation).
 *
 * Returns true if the signature is valid, false otherwise.
 * Throws if environment variables are missing.
 */
export async function verifyQStashSignature(req: Request): Promise<boolean> {
  const receiver = getReceiver();

  // We must read the raw body as text for signature verification.
  // QStash computes the signature over the raw request body.
  const body = await req.text();
  const signature = req.headers.get('upstash-signature');

  if (!signature) {
    return false;
  }

  try {
    await receiver.verify({
      signature,
      body,
    });
    return true;
  } catch {
    return false;
  }
}
