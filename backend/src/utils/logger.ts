import pino from "pino";
import { DEFAULTS } from "../types/index.js";

let loggerInstance: pino.Logger | null = null;

export function getLogger(): pino.Logger {
  if (!loggerInstance) {
    const isDev = process.env.NODE_ENV === "development";

    loggerInstance = pino({
      level: DEFAULTS.LOG_LEVEL,
      transport: isDev
        ? {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "SYS:standard",
              ignore: "pid,hostname",
            },
          }
        : {
            target: "pino-pretty",
            options: {
              colorize: false,
              translateTime: "SYS:HH:MM:ss",
              ignore: "pid,hostname,time",
              singleLine: true,
            },
          },
      formatters: {
        level: (label) => ({ level: label }),
      },
    });
  }

  return loggerInstance;
}

// Create child loggers for different modules
export function createModuleLogger(moduleName: string): pino.Logger {
  return getLogger().child({ module: moduleName });
}
