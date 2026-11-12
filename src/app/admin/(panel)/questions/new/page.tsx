import { QuestionForm } from "@/components/admin/QuestionForm";

export default function NewQuestion() {
  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-extrabold">Add a question</h1>
      <p className="max-w-3xl text-ink-soft">
        Manual questions follow the same rules as generated ones: a source, a verbatim supporting excerpt that includes the number, and approval
        before they can be scheduled. New questions go to the review queue.
      </p>
      <QuestionForm />
    </div>
  );
}
