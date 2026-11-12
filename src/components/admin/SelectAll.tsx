"use client";

/** Header checkbox that toggles every row checkbox named "ids" in the same form. */
export function SelectAll() {
  return (
    <input
      type="checkbox"
      aria-label="Select all questions in review on this page"
      title="Select all"
      onChange={(e) => {
        const form = e.currentTarget.form;
        if (!form) return;
        for (const el of Array.from(form.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="ids"]'))) {
          el.checked = e.currentTarget.checked;
        }
      }}
    />
  );
}
