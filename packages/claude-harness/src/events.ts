import { z } from "zod";

const UsageSchema = z.strictObject({
  input_tokens: z.number().int().nonnegative(),
  cache_creation_input_tokens: z.number().int().nonnegative().optional(),
  cache_read_input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative(),
});

const StreamEventSchema = z.strictObject({
  type: z.string().min(1),
}).passthrough();

const StreamEventWrapperSchema = z.strictObject({
  type: z.literal("stream_event"),
  event: StreamEventSchema,
});

const AssistantMessageSchema = z.strictObject({
  type: z.literal("assistant"),
  message: z.strictObject({
    id: z.string().min(1),
    type: z.literal("message"),
    role: z.literal("assistant"),
    content: z.array(z.record(z.string(), z.unknown())),
    model: z.string(),
    stop_reason: z.string().nullable(),
    stop_sequence: z.string().nullable(),
    usage: UsageSchema,
  }),
  session_id: z.string().min(1).optional(),
});

const ResultMessageSchema = z.strictObject({
  type: z.literal("result"),
  result: z.string().min(1),
  session_id: z.string().min(1).optional(),
});

const SystemMessageSchema = z.strictObject({
  type: z.literal("system"),
  subtype: z.string(),
  session_id: z.string().min(1).optional(),
});

const UserMessageSchema = z.strictObject({
  type: z.literal("user"),
  message: z.record(z.string(), z.unknown()).optional(),
  session_id: z.string().min(1).optional(),
});

const ErrorMessageSchema = z.strictObject({
  type: z.literal("error"),
  message: z.string().min(1),
  session_id: z.string().min(1).optional(),
});

export const ClaudeEventSchema = z.discriminatedUnion("type", [
  StreamEventWrapperSchema,
  AssistantMessageSchema,
  ResultMessageSchema,
  SystemMessageSchema,
  UserMessageSchema,
  ErrorMessageSchema,
]);

export type ClaudeEvent = z.infer<typeof ClaudeEventSchema>;
