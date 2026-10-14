import { execFile } from "node:child_process";

// Running ffmpeg and ffprobe. The functions that need them take an `Exec`, so tests give a fake and
// the filter graph is checked without a binary.

export type ExecResult = { stdout: string; stderr: string };
export type Exec = (file: string, args: readonly string[]) => Promise<ExecResult>;

const TEN_MINUTES = 10 * 60 * 1000;

export const defaultExec: Exec = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      { maxBuffer: 64 * 1024 * 1024, timeout: TEN_MINUTES },
      (error, stdout, stderr) => {
        if (error) {
          const tail = String(stderr).trim().split("\n").slice(-6).join("\n");
          reject(new Error(`${file} failed: ${error.message}${tail ? `\n${tail}` : ""}`));
        } else {
          resolve({ stdout: String(stdout), stderr: String(stderr) });
        }
      },
    );
  });
