import { z } from "zod";

const JsonRpcBaseSchema = z.strictObject({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]),
});

const JsonRpcRequestSchema = JsonRpcBaseSchema.extend({
  method: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
});

const JsonRpcErrorSchema = z.strictObject({
  code: z.number().int(),
  message: z.string().min(1),
  data: z.unknown().optional(),
});

const JsonRpcResponseSchema = JsonRpcBaseSchema.extend({
  result: z.unknown().optional(),
  error: JsonRpcErrorSchema.optional(),
});

export const PiEventSchema = z.discriminatedUnion("_kind", [
  z.strictObject({
    _kind: z.literal("request"),
    method: z.string().min(1),
    params: z.record(z.string(), z.unknown()).optional(),
    id: z.union([z.string(), z.number()]),
  }),
  z.strictObject({
    _kind: z.literal("response"),
    result: z.unknown().optional(),
    error: JsonRpcErrorSchema.optional(),
    id: z.union([z.string(), z.number(), z.null()]),
  }),
]);

export type PiEvent = z.infer<typeof PiEventSchema>;

export function parsePiLine(line: string): PiEvent {
  let raw: unknown;
  try {
    raw = JSON.parse(line) as unknown;
  } catch {
    throw new Error(`Invalid JSON in JSON-RPC message: ${line}`);
  }

  const request = JsonRpcRequestSchema.safeParse(raw);
  if (request.success && request.data.id !== null) {
    return {
      _kind: "request",
      method: request.data.method,
      params: request.data.params,
      id: request.data.id,
    };
  }

  // A JSON-RPC notification: request with id=null, or any valid response
  const notification = JsonRpcRequestSchema.safeParse(raw);
  if (notification.success) {
    // id is null — treat as a response-like event with no id
    return {
      _kind: "response",
      result: undefined,
      error: undefined,
      id: null,
    };
  }

  const response = JsonRpcResponseSchema.safeParse(raw);
  if (response.success) {
    return {
      _kind: "response",
      result: response.data.result,
      error: response.data.error,
      id: response.data.id,
    };
  }

  throw new Error(`Unrecognized JSON-RPC message: ${line}`);
}
