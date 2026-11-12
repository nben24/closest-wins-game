/** Pure helpers for the on-screen keypad (string-based to avoid float drift). */

export const MAX_INPUT_DIGITS = 15;

export function pressKey(
  current: string,
  key: string,
  opts: { allowDecimal: boolean; allowNegative: boolean },
): string {
  if (key === "back") return current.slice(0, -1);
  if (key === "clear") return "";
  if (key === "neg") {
    if (!opts.allowNegative) return current;
    return current.startsWith("-") ? current.slice(1) : `-${current}`;
  }
  if (key === ".") {
    if (!opts.allowDecimal || current.includes(".")) return current;
    const body = current.replace("-", "");
    return `${current.startsWith("-") ? "-" : ""}${body === "" ? "0" : body}.`;
  }
  if (/^\d$/.test(key)) {
    const digits = current.replace(/[^0-9]/g, "").length;
    if (digits >= MAX_INPUT_DIGITS) return current;
    const decimals = current.includes(".") ? current.split(".")[1].length : 0;
    if (decimals >= 6) return current;
    const sign = current.startsWith("-") ? "-" : "";
    const body = current.replace("-", "");
    if (body === "0") return `${sign}${key}`;
    return `${sign}${body}${key}`;
  }
  return current;
}

/** Multiply a decimal string by 10^k exactly (k ≥ 0). */
export function shiftDecimal(value: string, k: number): string {
  if (!value || value === "-" || value === ".") return value;
  const neg = value.startsWith("-");
  let [int, frac = ""] = value.replace("-", "").split(".");
  frac = frac.padEnd(k, "0");
  int = (int + frac.slice(0, k)).replace(/^0+(?=\d)/, "");
  const rest = frac.slice(k).replace(/0+$/, "");
  const out = rest ? `${int}.${rest}` : int;
  if (out.replace(/[^0-9]/g, "").length > MAX_INPUT_DIGITS) return value;
  return `${neg ? "-" : ""}${out || "0"}`;
}

/** Group the integer part with commas while preserving what was typed after the point. */
export function displayInput(value: string): string {
  if (!value) return "";
  const neg = value.startsWith("-");
  const [int, frac] = value.replace("-", "").split(".");
  const grouped = (int || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "−" : ""}${grouped}${frac !== undefined ? `.${frac}` : ""}`;
}
