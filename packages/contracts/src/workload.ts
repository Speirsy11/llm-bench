import { z } from "zod";

/**
 * Benchmark workloads: response cases and agentic workspace tasks. Response
 * cases default to three repetitions; agentic tasks default to one.
 */

export const ResponseCaseSchema = z.strictObject({
  id: z.string().min(1),
  prompt: z.string().min(1),
  repetitions: z.number().int().positive().default(3),
});
export type ResponseCase = z.infer<typeof ResponseCaseSchema>;

export const taskLanguages = ["typescript", "python"] as const;
export const TaskLanguageSchema = z.enum(taskLanguages);
export type TaskLanguage = z.infer<typeof TaskLanguageSchema>;

export const AgenticTaskSchema = z.strictObject({
  id: z.string().min(1),
  language: TaskLanguageSchema,
  constraints: z.array(z.string().min(1)),
  repetitions: z.number().int().positive().default(1),
});
export type AgenticTask = z.infer<typeof AgenticTaskSchema>;
