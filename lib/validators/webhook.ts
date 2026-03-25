import { z } from 'zod';

// Meta webhook verification handshake (GET /api/webhook)
export const WebhookVerifySchema = z.object({
  'hub.mode': z.literal('subscribe'),
  'hub.verify_token': z.string().min(1),
  'hub.challenge': z.string().min(1),
});

// Meta WhatsApp message contact
const WhatsAppContactSchema = z.object({
  profile: z.object({ name: z.string() }).optional(),
  wa_id: z.string(),
});

// Meta WhatsApp message text
const WhatsAppTextSchema = z.object({
  body: z.string(),
});

// Meta WhatsApp media object (audio, image, video, document)
const WhatsAppMediaSchema = z.object({
  id: z.string(),
  mime_type: z.string().optional(),
  sha256: z.string().optional(),
  caption: z.string().optional(),
});

// Individual message within a value object
const WhatsAppMessageSchema = z.object({
  id: z.string(),
  from: z.string(), // E.164 without +
  timestamp: z.string(),
  type: z.enum(['text', 'audio', 'image', 'video', 'document', 'sticker', 'reaction', 'unknown']),
  text: WhatsAppTextSchema.optional(),
  audio: WhatsAppMediaSchema.optional(),
  image: WhatsAppMediaSchema.optional(),
  video: WhatsAppMediaSchema.optional(),
  document: WhatsAppMediaSchema.optional(),
});

// Value object within an entry change
const WhatsAppValueSchema = z.object({
  messaging_product: z.literal('whatsapp'),
  metadata: z.object({
    display_phone_number: z.string(),
    phone_number_id: z.string(),
  }),
  contacts: z.array(WhatsAppContactSchema).optional(),
  messages: z.array(WhatsAppMessageSchema).optional(),
  statuses: z.array(z.unknown()).optional(),
  errors: z.array(z.unknown()).optional(),
});

// Full Meta webhook POST payload
export const WebhookPayloadSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(
        z.object({
          value: WhatsAppValueSchema,
          field: z.literal('messages'),
        })
      ),
    })
  ),
});

export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;
export type WhatsAppMessage = z.infer<typeof WhatsAppMessageSchema>;
export type WhatsAppValue = z.infer<typeof WhatsAppValueSchema>;
