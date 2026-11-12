import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { env } from "@/lib/env";
import { estimateCostUsd } from "@/lib/server/ai/pricing";
import { proposalSystemPrompt, proposalUserPrompt, RESEARCH_SYSTEM, researchUserPrompt } from "@/lib/server/ai/prompts";
import { ProposalBatchSchema, ResearchSchema, toStrictJsonSchema, type Proposal, type Research } from "@/lib/server/ai/schemas";

export interface CallUsage {
  purpose: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  webSearches: number;
  costUsd: number;
}

export interface ProposeInput {
  count: number;
  categories: string[];
  difficulty: { easy: number; medium: number; hard: number };
  instructions: string;
  avoidSubjects: string[];
  maxTokens: number;
}

export interface AiProvider {
  name: string;
  model: string;
  propose(input: ProposeInput): Promise<{ proposals: unknown[]; usage: CallUsage[] }>;
  research(p: Proposal, maxTokens: number): Promise<{ research: Research; usage: CallUsage[] }>;
}

export class AiError extends Error {
  constructor(
    message: string,
    public usage: CallUsage[] = [],
    public retryable = true,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Claude (Anthropic API) implementation

/** Models that take the newer web tools with dynamic filtering. Others (e.g. Haiku) use the basic variants. */
const DYNAMIC_WEB_TOOLS = /^claude-(opus-(5-5|5|4-8|4-7|4-6)|sonnet-(5-5|5|4-6)|fable-|mythos-)/;
/** Models that accept the server-side refusal fallback ("default" routing). Haiku has none. */
const SERVER_FALLBACKS = /^claude-(opus-(5-5|5)|sonnet-5-5|fable-5-(1|2)|mythos-5-(1|2))$/;

export function webTools(model: string) {
  return DYNAMIC_WEB_TOOLS.test(model)
    ? ([
        { type: "web_search_20260209", name: "web_search", max_uses: 2 },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 2, max_content_tokens: 12_000 },
      ] as const)
    : ([
        { type: "web_search_20250305", name: "web_search", max_uses: 2 },
        { type: "web_fetch_20250910", name: "web_fetch", max_uses: 2, max_content_tokens: 12_000 },
      ] as const);
}

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type BetaParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

function usageOf(purpose: string, msg: BetaMessage): CallUsage {
  const u = msg.usage;
  const webSearches = u.server_tool_use?.web_search_requests ?? 0;
  const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const output = u.output_tokens ?? 0;
  return {
    purpose,
    model: msg.model,
    inputTokens: input + cacheRead,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    webSearches,
    // cache reads are billed at a fraction of input; treat them as full input to stay conservative
    costUsd: estimateCostUsd(msg.model, input + cacheRead, output, webSearches),
  };
}

function textOf(msg: BetaMessage): string {
  return msg.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/** Pull the last JSON object out of model text (```json fenced or bare). */
export function extractJson(text: string): unknown {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const candidates = fenced.length ? fenced.reverse() : [];
  const lastBrace = text.lastIndexOf("}");
  const firstBrace = text.indexOf("{");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(text.slice(firstBrace, lastBrace + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c.trim());
    } catch {
      /* try next */
    }
  }
  return null;
}

export class ClaudeProvider implements AiProvider {
  name = "anthropic";
  private client: Anthropic;

  constructor(
    apiKey: string,
    public model: string,
  ) {
    this.client = new Anthropic({ apiKey, timeout: 180_000, maxRetries: 2 });
  }

  /**
   * One request. Opts into server-side refusal fallbacks ("default" routing);
   * resumes `pause_turn` (long server-tool turns) a bounded number of times.
   */
  private async call(purpose: string, params: Omit<BetaParams, "model">): Promise<{ msg: BetaMessage; usage: CallUsage[] }> {
    const usage: CallUsage[] = [];
    let messages = params.messages;
    for (let i = 0; i < 4; i++) {
      let msg: BetaMessage;
      try {
        msg = await this.client.beta.messages.create({
          ...params,
          model: this.model,
          messages,
          ...(SERVER_FALLBACKS.test(this.model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
        } as BetaParams);
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError) throw new AiError("The Anthropic API key was rejected.", usage, false);
        if (e instanceof Anthropic.PermissionDeniedError) throw new AiError("The Anthropic API key lacks permission for this model or feature.", usage, false);
        if (e instanceof Anthropic.BadRequestError) throw new AiError(`The AI request was rejected: ${e.message.slice(0, 300)}`, usage, false);
        if (e instanceof Anthropic.RateLimitError) throw new AiError("AI rate limit reached; will retry later.", usage, true);
        if (e instanceof Anthropic.APIError) throw new AiError(`AI service error (${e.status ?? "network"}).`, usage, true);
        throw new AiError("Could not reach the AI service.", usage, true);
      }
      usage.push(usageOf(purpose, msg));
      if (msg.stop_reason === "refusal") throw new AiError("The model declined this request.", usage, false);
      if (msg.stop_reason === "pause_turn") {
        messages = [...params.messages, { role: "assistant", content: msg.content }];
        continue;
      }
      if (msg.stop_reason === "max_tokens") throw new AiError("The model ran out of output tokens.", usage, true);
      return { msg, usage };
    }
    throw new AiError("The model paused too many times.", usage, true);
  }

  private async structured<T>(purpose: string, schema: z.ZodType<T>, system: string, user: string, maxTokens: number) {
    const { msg, usage } = await this.call(purpose, {
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: toStrictJsonSchema(schema) } },
    } as Omit<BetaParams, "model">);
    let parsed: unknown;
    try {
      parsed = JSON.parse(textOf(msg));
    } catch {
      throw new AiError("The model returned invalid JSON.", usage, true);
    }
    const r = schema.safeParse(parsed);
    if (!r.success) throw new AiError("The model's output did not match the expected schema.", usage, true);
    return { data: r.data, usage };
  }

  async propose(input: ProposeInput) {
    // Validate the batch envelope only; each proposal is validated individually by the pipeline.
    const { data, usage } = await this.structured(
      "propose",
      ProposalBatchSchema,
      proposalSystemPrompt(),
      proposalUserPrompt(input),
      input.maxTokens,
    );
    return { proposals: data.questions as unknown[], usage };
  }

  async research(p: Proposal, maxTokens: number) {
    const { msg, usage } = await this.call("research", {
      max_tokens: maxTokens,
      system: RESEARCH_SYSTEM,
      messages: [{ role: "user", content: researchUserPrompt(p) }],
      output_config: { effort: "medium" },
      tools: [...webTools(this.model)],
    } as Omit<BetaParams, "model">);
    const first = ResearchSchema.safeParse(extractJson(textOf(msg)));
    if (first.success) return { research: first.data, usage };
    // Reformat the model's own report into the schema (no tools, structured output).
    const re = await this.structured(
      "research_reformat",
      ResearchSchema,
      "Convert the fact-check report into the JSON schema. Copy values exactly; use null when a value is missing. Do not add facts.",
      `<report>\n${textOf(msg).slice(0, 20_000)}\n</report>`,
      4000,
    );
    return { research: re.data, usage: [...usage, ...re.usage] };
  }
}

// ---------------------------------------------------------------------------

let override: AiProvider | null = null;

export function setAiProviderForTests(p: AiProvider | null): void {
  override = p;
}

/** null when no API key is configured — generation is then disabled. */
export function getAiProvider(): AiProvider | null {
  if (override) return override;
  const key = env.anthropicApiKey;
  if (!key) return null;
  return new ClaudeProvider(key, env.anthropicModel);
}

export function aiStatus(): { configured: boolean; provider: string; model: string; testOverride: boolean } {
  return { configured: Boolean(override || env.anthropicApiKey), provider: "anthropic", model: override?.model ?? env.anthropicModel, testOverride: Boolean(override) };
}
