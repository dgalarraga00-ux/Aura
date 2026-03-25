// Job types for the QStash worker pipeline
// Separate from messages.ts to allow importing without pulling in all message types

export type WorkerJobType = 'message' | 'ingestion';

/**
 * Ingestion job payload published to QStash when a new ingestion_job is created.
 * Consumed by the worker route when type=ingestion.
 */
export interface IngestionJob {
  type: 'ingestion';
  jobId: string;
  tenantId: string;
  sourceId: string;
  storagePath: string | null;
  sourceUrl: string | null;
  sourceType: 'pdf' | 'url' | 'csv' | 'text';
}
