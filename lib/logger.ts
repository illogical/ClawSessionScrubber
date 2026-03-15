import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const LOGS_DIR = join(import.meta.dir, "..", "logs");

class Logger {
  private async writeToFile(level: string, line: string): Promise<void> {
    const date = new Date().toISOString().slice(0, 10);
    await mkdir(LOGS_DIR, { recursive: true });
    await appendFile(join(LOGS_DIR, `${date}.log`), line + "\n", "utf8");
  }

  private format(level: string, message: string, meta?: unknown): string {
    const ts = new Date().toISOString();
    const metaStr = meta !== undefined ? ` | ${JSON.stringify(meta)}` : "";
    return `[${ts}] [${level}] ${message}${metaStr}`;
  }

  info(message: string, meta?: unknown): void {
    const line = this.format("INFO ", message, meta);
    console.log(line);
    this.writeToFile("INFO", line).catch(() => {});
  }

  warn(message: string, meta?: unknown): void {
    const line = this.format("WARN ", message, meta);
    console.warn(line);
    this.writeToFile("WARN", line).catch(() => {});
  }

  error(message: string, err?: unknown, meta?: unknown): void {
    const errMeta =
      err instanceof Error
        ? { error: err.message, stack: err.stack }
        : err !== undefined
          ? { error: String(err) }
          : undefined;
    const combined =
      errMeta !== undefined || meta !== undefined
        ? { ...errMeta, ...((meta as object) ?? {}) }
        : undefined;
    const line = this.format("ERROR", message, combined);
    console.error(line);
    this.writeToFile("ERROR", line).catch(() => {});
  }
}

export const logger = new Logger();
