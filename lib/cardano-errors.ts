type ErrorLike = {
  message?: unknown;
  info?: unknown;
};

function errorDetail(cause: unknown) {
  if (typeof cause === "string") return cause;
  if (!cause || typeof cause !== "object") return "";
  const value = cause as ErrorLike;
  if (typeof value.info === "string") return value.info;
  return typeof value.message === "string" ? value.message : "";
}

function hasConnectionErrorCode(normalized: string) {
  return /\beconn(?:aborted|closed|refused|reset)?\b/.test(normalized);
}

export function isRetryableCardanoReadError(cause: unknown) {
  const normalized = errorDetail(cause).toLowerCase();
  return (
    normalized.includes("timeoutexception") ||
    normalized.includes("timed out") ||
    normalized.includes("timeout") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("fetch failed") ||
    normalized.includes("networkerror") ||
    normalized.includes("network error") ||
    hasConnectionErrorCode(normalized) ||
    normalized.includes("could not be reached") ||
    normalized.includes("429") ||
    normalized.includes("too many requests")
  );
}

/** Retry only idempotent provider reads. Never wrap signing or submission. */
export async function withCardanoReadRetry<T>(
  operation: () => Promise<T>,
  attempts = 2,
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (cause) {
      lastError = cause;
      if (attempt === attempts || !isRetryableCardanoReadError(cause)) throw cause;
    }
  }
  throw lastError;
}

/**
 * Keep provider and runtime internals out of the interface while preserving
 * concise protocol errors that help a person correct a plan or wallet state.
 */
export function cardanoErrorMessage(
  cause: unknown,
  fallback = "Baton could not read the latest confirmed Cardano state.",
) {
  const detail = errorDetail(cause).trim();
  const normalized = detail.toLowerCase();

  if (normalized.includes("timeoutexception") || normalized.includes("timed out") || normalized.includes("timeout")) {
    return "Cardano is taking longer than expected to respond. Nothing changed. Try again.";
  }

  if (
    normalized.includes("failed to fetch") ||
    normalized.includes("fetch failed") ||
    normalized.includes("networkerror") ||
    normalized.includes("network error") ||
    hasConnectionErrorCode(normalized) ||
    normalized.includes("could not be reached")
  ) {
    return "Baton could not reach Cardano. Nothing changed. Check your connection and try again.";
  }

  if (normalized.includes("429") || normalized.includes("too many requests")) {
    return "Cardano is receiving too many requests right now. Nothing changed. Try again shortly.";
  }

  const firstLine = detail.split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (
    !firstLine ||
    /(?:https?:\/\/|\bat (?:async )?[\w$.<>]+\s*\(|node_modules|_next\/static)/i.test(firstLine)
  ) {
    return fallback;
  }

  return firstLine;
}
