/** Server clock. The authoritative time source for rounds; injectable for tests. */
let override: (() => Date) | null = null;

export function now(): Date {
  return override ? override() : new Date();
}

export function setClockForTests(fn: (() => Date) | null): void {
  override = fn;
}
