import { Config, ConfigSchema } from "../types/index.js";
import dotenv from "dotenv";

dotenv.config();

function env(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function envNum(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const parsed = parseFloat(value);
  if (isNaN(parsed)) {
    throw new Error(`Invalid number for environment variable: ${key}`);
  }
  return parsed;
}

export function loadConfig(): Config {
  const rawConfig = {
    db: {
      url: env("SUPABASE_DATABASE_URL"),
    },
    polymarket: {
      privateKey: env("POLYMARKET_PRIVATE_KEY"),
      apiKey: env("POLYMARKET_API_KEY"),
      apiSecret: env("POLYMARKET_API_SECRET"),
      apiPassphrase: env("POLYMARKET_API_PASSPHRASE"),
    },
    portfolio: {
      startingCapital: envNum("STARTING_CAPITAL", 100),
    },
    strategy: {
      marketWindow: env("MARKET_WINDOW", "5M"),
      tradeFromWindowSeconds: envNum("TRADE_FROM_WINDOW_SECONDS", 90),
      entryPriceThreshold: envNum("ENTRY_PRICE_THRESHOLD", 0.94),
      maxEntryPrice: envNum("MAX_ENTRY_PRICE", 0.98),
      stopLossPriceTrigger: envNum("STOP_LOSS_PRICE_TRIGGER", 0.75),
    },
    admin: {
      password: env("ADMIN_PASSWORD"),
    },
    server: {
      port: envNum("PORT", 4000),
    },
  };

  return ConfigSchema.parse(rawConfig);
}

let configInstance: Config | null = null;

export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}
