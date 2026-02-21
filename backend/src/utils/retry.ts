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

export function calculateBackoff(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterMs: number,
): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
  return cappedDelay + Math.random() * jitterMs;
}

export function isRateLimitError(error: unknown): boolean {
  if (error && typeof error === "object") {
    const err = error as { response?: { status?: number }; status?: number };
    return err.response?.status === 429 || err.status === 429;
  }
  return false;
}

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

      if (attempt === opts.maxRetries) break;
      if (opts.retryOn && !opts.retryOn(error)) break;

      const delay = calculateBackoff(
        attempt,
        opts.baseDelayMs,
        opts.maxDelayMs,
        opts.jitterMs,
      );
      logger.debug({ attempt, delay }, "Retrying after delay");
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
