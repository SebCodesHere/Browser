import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

export type LogLevel = "debug" | "info" | "warn" | "error";

let logFile: string | null = null;
let logStream: fs.WriteStream | null = null;

export function initLogger(): string {
  const dir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(dir, { recursive: true });
  logFile = path.join(dir, "xuvon.log");
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5 * 1024 * 1024) {
      fs.renameSync(logFile, `${logFile}.1`);
    }
    logStream = fs.createWriteStream(logFile, { flags: "a" });
  } catch {
    logStream = null;
  }
  return logFile;
}

export function getLogFile(): string {
  return logFile ?? path.join(app.getPath("userData"), "logs", "xuvon.log");
}

export function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    target: "xuvon-host",
    msg: message,
    ...(data ?? {})
  };
  if (level === "error") {
    console.error(message, data ?? "");
  } else if (level === "warn") {
    console.warn(message, data ?? "");
  }
  try {
    logStream?.write(`${JSON.stringify(entry)}\n`);
  } catch {
    // Logging must never break the browser.
  }
}

export function logCoreStderr(line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    logStream?.write(`${trimmed}\n`);
  } catch {
    // Ignore.
  }
}

export function closeLogger(): void {
  logStream?.end();
  logStream = null;
}
