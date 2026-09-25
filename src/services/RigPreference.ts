const KEY = "bierrad.weights.v1";
/** Weights stay on this device until reset; forced wins are never stored. */
export function loadWeights(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([, value]) =>
          typeof value === "number" && Number.isFinite(value) && value >= 0,
      ),
    ) as Record<string, number>;
  } catch {
    return {};
  }
}
export function saveWeights(weights: Record<string, number>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(weights));
  } catch {
    /* Storage is optional; weights then last for this window only. */
  }
}
