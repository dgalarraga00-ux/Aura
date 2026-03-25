// Types for message processing pipeline
// StandardMessage: output of MessageAdapter (normalized WhatsApp payload)
// WorkerJob: QStash payload published by webhook and consumed by worker

export type MessageType = 'text' | 'audio' | 'image' | 'video' | 'document' | 'unknown';

/**
 * Normalized representation of an inbound WhatsApp message.
 * Produced by MessageAdapter from the raw Meta webhook payload.
 */
export interface StandardMessage {
  /** wa_msg_id — used as idempotency key in messages.message_external_id */
  externalId: string;
  /** UUID of the tenant that owns this phone number */
  tenantId: string;
  /** E.164 format (e.g. "+5491112345678") */
  contactPhone: string;
  contactName: string | null;
  type: MessageType;
  /** Original text, or Whisper transcription for audio messages */
  text: string | null;
  /** Temporary Meta media URL (valid 5min) or Supabase Storage URL after upload */
  mediaUrl: string | null;
  mediaMimeType: string | null;
  timestamp: Date;
  /** Raw Meta payload preserved for debugging */
  raw: Record<string, unknown>;
}

/**
 * Payload published to QStash by the webhook and consumed by the worker.
 * Serializable — all fields are primitives or ISO strings.
 */
export interface WorkerJob {
  tenantId: string;
  messageExternalId: string;
  /** E.164 format */
  contactPhone: string;
  contactName: string | null;
  type: MessageType;
  /** Original text or transcription (may be null for media before processing) */
  text: string | null;
  /** Temporary Meta media URL — worker downloads and re-uploads to Storage */
  mediaUrl: string | null;
  mediaMimeType: string | null;
  /** ISO 8601 timestamp of the original WhatsApp message */
  timestamp: string;
}
