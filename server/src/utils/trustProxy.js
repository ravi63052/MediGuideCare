export function parseTrustProxy(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return 1;
  if (trimmed === "false") return false;
  if (trimmed === "true") return 1;

  const asNumber = Number(trimmed);
  return Number.isInteger(asNumber) ? asNumber : trimmed;
}
