import { Client } from '@upstash/qstash';
import type { WorkerJob } from '@/types/messages';

let qstashInstance: Client | null = null;

function getQStashClient(): Client {
  if (!qstashInstance) {
    const token = process.env.QSTASH_TOKEN;
    if (!token) {
      throw new Error('Missing QSTASH_TOKEN environment variable');
    }
    qstashInstance = new Client({ token });
  }
  return qstashInstance;
}

/**
 * Publishes a WorkerJob to QStash, targeting the /api/worker endpoint.
 *
 * - timeout=55s: leaves 5s buffer within Vercel Pro's maxDuration=60s
 * - retries=3: QStash will retry on non-2xx responses from the worker
 * - The worker URL must be an absolute URL (required by QStash)
 */
export async function publishMessage(payload: WorkerJob): Promise<void> {
  const workerUrl = process.env.QSTASH_WORKER_URL;
  if (!workerUrl) {
    throw new Error('Missing QSTASH_WORKER_URL environment variable');
  }

  const client = getQStashClient();

  await client.publishJSON({
    url: workerUrl,
    body: payload,
    timeout: 55,
    retries: 3,
  });
}
