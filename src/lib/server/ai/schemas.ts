import { z } from "zod";
import { CATEGORIES, DIFFICULTIES } from "@/lib/content-checks";
import { SCORING_TYPES } from "@/lib/scoring";

/** One proposed question (before any verification). */
export const ProposalSchema = z.object({
  prompt: z.string(),
  answer: z.number(),
  unit: z.string(),
  category: z.enum(CATEGORIES),
  difficulty: z.enum(DIFFICULTIES),
  scoring_type: z.enum(SCORING_TYPES),
  tolerance: z.number(),
  allow_decimal: z.boolean(),
  allow_negative: z.boolean(),
  explanation: z.string(),
  subject: z.string(),
  reference_period: z.string().nullable(),
  why_estimable: z.string(),
  /** Where the proposer expects the fact to be documented (checked, never trusted). */
  suggested_source_url: z.string().nullable(),
});
export type Proposal = z.infer<typeof ProposalSchema>;

export const ProposalBatchSchema = z.object({ questions: z.array(ProposalSchema) });

/** What the research step reports back. */
export const ResearchSchema = z.object({
  verdict: z.enum(["supported", "contradicted", "unclear", "not_found"]),
  source_url: z.string().nullable(),
  source_title: z.string().nullable(),
  source_type: z.enum(["primary", "secondary", "unknown"]),
  excerpt: z.string().nullable(),
  value_in_source: z.number().nullable(),
  unit_in_source: z.string().nullable(),
  reference_period: z.string().nullable(),
  matches_wording: z.boolean(),
  ambiguity_notes: z.string(),
  is_ambiguous: z.boolean(),
  family_friendly: z.boolean(),
  suggested_difficulty: z.enum(DIFFICULTIES),
  conflicting_sources: z.boolean(),
  notes: z.string(),
});
export type Research = z.infer<typeof ResearchSchema>;

/**
 * Convert a Zod schema into the strict JSON Schema subset accepted by
 * structured outputs: every object closed (additionalProperties: false), all
 * properties required, unsupported validation keywords removed.
 */
export function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { target: "draft-7", io: "output" }) as Record<string, unknown>;
  const DROP = new Set(["$schema", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "pattern", "format", "minItems", "maxItems"]);
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) if (!DROP.has(k)) out[k] = walk(v);
    if (out.type === "object" && out.properties) {
      out.additionalProperties = false;
      out.required = Object.keys(out.properties as object);
    }
    return out;
  };
  return walk(raw) as Record<string, unknown>;
}
