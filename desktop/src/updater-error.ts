const MAX_DETAIL = 280;

function collectErrorText(err: unknown): string {
  if (err instanceof Error) {
    const extra = (err as Error & { statusCode?: number; code?: string });
    const bits = [err.message, extra.statusCode, extra.code];
    if (err.cause) bits.push(collectErrorText(err.cause));
    return bits.filter(Boolean).join(" ");
  }
  if (err && typeof err === "object") {
    const rec = err as { message?: unknown; statusCode?: unknown; code?: unknown };
    return [rec.message, rec.statusCode, rec.code].filter(Boolean).join(" ");
  }
  return String(err || "unknown");
}

function looksLikeHtml(text: string): boolean {
  return /<!DOCTYPE|<html[\s>]|<\/?(html|head|body|style|script)\b|data:image\/svg/i.test(
    text,
  );
}

function stripHtml(text: string): string {
  return text
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Never show GitHub HTML / YAML dumps in native dialogs or the in-app banner. */
export function friendlyUpdateError(err: unknown): string {
  const raw = collectErrorText(err);
  const blob = raw.slice(0, 8000);

  if (/Code signature|podpis|did not pass validation|zasobów/i.test(blob)) {
    return "Podpis aktualizacji odrzucony (unsigned build). Pobierz nową wersję ręcznie z GitHub Releases.";
  }
  if (
    /\b429\b|too many requests|rate.?limit|secondary rate/i.test(blob) ||
    (looksLikeHtml(blob) && /too many|rate.?limit/i.test(blob))
  ) {
    return "GitHub ograniczył zapytania (429). Poczekaj kilka minut i sprawdź ponownie, albo pobierz release ręcznie.";
  }
  if (/ERR_HTTP2|HTTP2|REFUSED_STREAM|PROTOCOL_ERROR/i.test(blob)) {
    return "GitHub odmówił połączenia HTTP/2. Spróbuj ponownie za chwilę albo pobierz release ręcznie.";
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::ERR_/i.test(blob)) {
    return "Brak połączenia z serwerem aktualizacji. Sprawdź sieć i spróbuj ponownie.";
  }
  if (looksLikeHtml(blob) || blob.length > 600) {
    return "Nie udało się pobrać informacji o aktualizacji z GitHuba. Spróbuj za chwilę albo pobierz release ręcznie.";
  }
  const cleaned = stripHtml(blob);
  if (!cleaned) {
    return "Nie udało się sprawdzić aktualizacji.";
  }
  return cleaned.length > MAX_DETAIL
    ? `${cleaned.slice(0, MAX_DETAIL).trim()}…`
    : cleaned;
}
