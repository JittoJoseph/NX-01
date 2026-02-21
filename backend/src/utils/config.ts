import { Config, ConfigSchema } from "../types/index.js";
import dotenv from "dotenv";

// Load .env file
dotenv.config();

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Invalid number for environment variable: ${key}`);
  }
  return parsed;
}

export function loadConfig(): Config {
  const rawConfig = {
    poly: {
      gammaApiBase: getEnvVar(
        "POLY_GAMMA_API_BASE",
        "https://gamma-api.polymarket.com",
      ),
      clobBase: getEnvVar("POLY_CLOB_BASE", "https://clob.polymarket.com"),
      clobWs: getEnvVar(
        "POLY_CLOB_WS",
        "wss://ws-subscriptions-clob.polymarket.com/ws/",
      ),
    },
    db: {
      url: getEnvVar("SUPABASE_DATABASE_URL"),
    },
    simulation: {
      amountUsd: getEnvNumber("SIMULATION_AMOUNT_USD", 1),
      entryThreshold: parseFloat(getEnvVar("STRATEGY_ENTRY_THRESHOLD", "0.75")),
      entryThresholdMax: parseFloat(
        getEnvVar("STRATEGY_ENTRY_THRESHOLD_MAX", "0.80"),
      ),
      claimDelayMs: getEnvNumber("CLAIM_DELAY_MS", 300000), // 5 minutes default
    },
    strategy: {
      maxSimultaneousPositions: getEnvNumber("MAX_SIMULTANEOUS_POSITIONS", 20),
      nearEndWindowSeconds: getEnvNumber("NEAR_END_WINDOW_SECONDS", 60),
      scanIntervalMs: getEnvNumber("SCAN_INTERVAL_MS", 120000), // 2 min
      minLookAheadMs: getEnvNumber("MIN_LOOK_AHEAD_MS", 7200000), // 2 hours
    },
    stopLoss: {
      enabled: process.env.STOP_LOSS_ENABLED !== "false", // Default: enabled
      threshold: parseFloat(process.env.STOP_LOSS_THRESHOLD ?? "0.50"), // Exit if price drops to 50¢
    },
    wipe: {
      password: getEnvVar("WIPE_PASSWORD"),
    },
    server: {
      port: getEnvNumber("PORT", 4000),
      host: getEnvVar("HOST", "0.0.0.0"),
    },
    logging: {
      level: getEnvVar("LOG_LEVEL", "info") as Config["logging"]["level"],
    },
    env: getEnvVar("NODE_ENV", "development") as Config["env"],
  };

  // Validate config
  return ConfigSchema.parse(rawConfig);
}

// Singleton config instance
let configInstance: Config | null = null;

export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}
