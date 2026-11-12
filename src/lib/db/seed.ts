import type { Db } from "@/lib/db";
import { DEMO_QUESTIONS } from "@/lib/demo-questions";
import { normalizePrompt, normalizeSubject } from "@/lib/similarity";

/**
 * Load the labeled demo questions. They are approved *as demo content* only:
 * provenance = 'demo', verification_status = 'unverified'. Production
 * scheduling ignores them unless ALLOW_DEMO_CONTENT=true.
 */
export async function seedDemoQuestions(db: Db): Promise<number> {
  let inserted = 0;
  for (const q of DEMO_QUESTIONS) {
    const rows = await db.query(
      `insert into questions (prompt, answer, unit, category, difficulty, scoring_type, tolerance, allow_decimal,
          allow_negative, explanation, source_url, source_title, source_excerpt, reference_period, subject_key,
          normalized_prompt, status, verification_status, verification_notes, provenance, is_demo, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,null,$13,$14,$15,'approved','unverified',$16,'demo',true,'seed')
       on conflict do nothing returning id`,
      [
        q.prompt, q.answer, q.unit, q.category, q.difficulty, q.scoringType, q.tolerance, q.allowDecimal ?? true,
        q.allowNegative ?? false, q.explanation, q.referenceUrl, q.referenceTitle, q.referencePeriod ?? null,
        normalizeSubject(q.subject), normalizePrompt(q.prompt),
        JSON.stringify([{ level: "warning", message: "Demo content written from general knowledge. The reference link has not been verified." }]),
      ],
    );
    inserted += rows.length;
  }
  return inserted;
}
