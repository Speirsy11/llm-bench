import { z } from "zod";

const UsageSchema = z.strictObject({
  input_tokens: z.number().int().nonnegative(),
  cached_input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  reasoning_output_tokens: z.number().int().nonnegative(),
});

export const CodexEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("thread.started"),
    thread_id: z.string().min(1),
  }),
  z.strictObject({ type: z.literal("turn.started") }),
  z.strictObject({
    type: z.literal("turn.completed"),
    usage: UsageSchema,
  }),
  z.strictObject({
    type: z.literal("turn.failed"),
    error: z.unknown().optional(),
  }),
  z.strictObject({
    type: z.literal("error"),
    message: z.string().min(1),
  }),
  z.strictObject({
    type: z.literal("item.started"),
    item: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({
    type: z.literal("item.updated"),
    item: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({
    type: z.literal("item.completed"),
    item: z.record(z.string(), z.unknown()),
  }),
]);

export type CodexEvent = z.infer<typeof CodexEventSchema>;
