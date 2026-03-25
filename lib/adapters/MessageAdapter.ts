import type { StandardMessage, MessageType } from '@/types/messages';
import type { WhatsAppMessage, WhatsAppValue } from '@/lib/validators/webhook';

/**
 * MessageAdapter normalizes a raw Meta WhatsApp payload into a StandardMessage.
 *
 * Supported types: text, audio, image, video, document
 * Unsupported types (sticker, reaction, unknown, etc.) → type set to 'unknown',
 * text set to null, and the caller is responsible for logging and skipping.
 */
export class MessageAdapter {
  /**
   * Normalize a single WhatsApp message entry into a StandardMessage.
   *
   * @param message   - The raw WhatsApp message object from the webhook payload
   * @param value     - The value object containing metadata and contacts
   * @param tenantId  - UUID of the resolved tenant
   */
  static normalize(
    message: WhatsAppMessage,
    value: WhatsAppValue,
    tenantId: string
  ): StandardMessage {
    const contactName =
      value.contacts?.find((c) => c.wa_id === message.from)?.profile?.name ?? null;

    const type = MessageAdapter.resolveType(message.type);
    const { text, mediaUrl, mediaMimeType } = MessageAdapter.extractContent(message);

    // Timestamp from Meta is Unix seconds as string
    const timestamp = new Date(parseInt(message.timestamp, 10) * 1000);

    return {
      externalId: message.id,
      tenantId,
      contactPhone: `+${message.from}`, // Meta sends E.164 without the +
      contactName,
      type,
      text,
      mediaUrl,
      mediaMimeType,
      timestamp,
      raw: message as unknown as Record<string, unknown>,
    };
  }

  /**
   * Map WhatsApp message type string to our MessageType enum.
   * Any unrecognized type maps to 'unknown'.
   */
  private static resolveType(rawType: string): MessageType {
    const supported: MessageType[] = ['text', 'audio', 'image', 'video', 'document'];
    if (supported.includes(rawType as MessageType)) {
      return rawType as MessageType;
    }
    return 'unknown';
  }

  /**
   * Extract text content, media URL, and MIME type from a WhatsApp message.
   *
   * For media messages, the media object contains a Meta media ID (not a URL).
   * The actual download URL must be fetched separately via the Meta Graph API
   * using that ID. We store the ID as mediaUrl until the worker fetches the
   * real URL.
   */
  private static extractContent(message: WhatsAppMessage): {
    text: string | null;
    mediaUrl: string | null;
    mediaMimeType: string | null;
  } {
    switch (message.type) {
      case 'text':
        return {
          text: message.text?.body ?? null,
          mediaUrl: null,
          mediaMimeType: null,
        };

      case 'audio':
        return {
          text: null, // populated by Whisper transcription in Phase 3
          mediaUrl: message.audio?.id ?? null,
          mediaMimeType: message.audio?.mime_type ?? null,
        };

      case 'image':
        return {
          text: message.image?.caption ?? null,
          mediaUrl: message.image?.id ?? null,
          mediaMimeType: message.image?.mime_type ?? null,
        };

      case 'video':
        return {
          text: message.video?.caption ?? null,
          mediaUrl: message.video?.id ?? null,
          mediaMimeType: message.video?.mime_type ?? null,
        };

      case 'document':
        return {
          text: message.document?.caption ?? null,
          mediaUrl: message.document?.id ?? null,
          mediaMimeType: message.document?.mime_type ?? null,
        };

      default:
        // sticker, reaction, unknown — unsupported
        return {
          text: null,
          mediaUrl: null,
          mediaMimeType: null,
        };
    }
  }
}
