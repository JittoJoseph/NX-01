import { createModuleLogger } from "./logger.js";

const logger = createModuleLogger("retry");

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterMs: number;
  retryOn?: (error: unknown) => boolean;
}

const defaultOptions: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterMs: 500,
};

/**
 * Calculate exponential backoff delay with jitter
 */
export function calculateBackoff(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterMs: number,
): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
  const jitter = Math.random() * jitterMs;
  return cappedDelay + jitter;
}

/**
 * Check if an error is a rate limit error (HTTP 429)
 */
export function isRateLimitError(error: unknown): boolean {
  if (error && typeof error === "object") {
    const err = error as { response?: { status?: number }; status?: number };
    return err.response?.status === 429 || err.status === 429;
  }
  return false;
}

/**
 * Extract Retry-After header value in milliseconds
 */
export function getRetryAfterMs(error: unknown): number | null {
  if (error && typeof error === "object") {
    const err = error as {
      response?: { headers?: { "retry-after"?: string } };
    };
    const retryAfter = err.response?.headers?.["retry-after"];
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) {
        return seconds * 1000;
      }
    }
  }
  return null;
}

/**
 * Retry a function with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts = { ...defaultOptions, ...options };
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry this error
      if (opts.retryOn && !opts.retryOn(error)) {
        throw error;
      }

      // Don't retry on last attempt
      if (attempt === opts.maxRetries) {
        break;
      }

      // Calculate delay
      let delayMs: number;

      // Respect Retry-After header for rate limits
      if (isRateLimitError(error)) {
        const retryAfter = getRetryAfterMs(error);
        delayMs =
          retryAfter ??
          calculateBackoff(
            attempt,
            opts.baseDelayMs,
            opts.maxDelayMs,
            opts.jitterMs,
          );
        logger.warn(
          { attempt, delayMs, retryAfter },
          "Rate limited, backing off",
        );
      } else {
        delayMs = calculateBackoff(
          attempt,
          opts.baseDelayMs,
          opts.maxDelayMs,
          opts.jitterMs,
        );
        logger.debug(
          { attempt, delayMs, error: String(error) },
          "Retrying after error",
        );
      }

      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a timeout promise that rejects after the given time
 */
export function timeout<T>(
  promise: Promise<T>,
  ms: number,
  message = "Operation timed out",
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms),
    ),
  ]);
}
