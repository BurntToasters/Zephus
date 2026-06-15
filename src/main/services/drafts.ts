import { app } from "electron";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { DraftData, DraftResult, OperationResult } from "../types";

type DraftStore = Record<string, DraftData>;

function draftsPath(): string {
  return path.join(app.getPath("userData"), "drafts.json");
}

function draftKey(projectPath: string, page: string): string {
  return crypto
    .createHash("sha1")
    .update(path.resolve(projectPath) + "::" + page)
    .digest("hex");
}

function readStore(): DraftStore {
  const file = draftsPath();
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as DraftStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: DraftStore): void {
  const file = draftsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2) + "\n", "utf8");
}

export function readDraft(projectPath: string, page: string): DraftResult {
  try {
    const draft = readStore()[draftKey(projectPath, page)] ?? null;
    return { ok: true, draft };
  } catch (error) {
    return {
      ok: false,
      draft: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function writeDraft(
  projectPath: string,
  page: string,
  content: string,
): OperationResult {
  try {
    const store = readStore();
    store[draftKey(projectPath, page)] = {
      page,
      content,
      savedAt: new Date().toISOString(),
    };
    writeStore(store);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function clearDraft(projectPath: string, page: string): OperationResult {
  try {
    const store = readStore();
    delete store[draftKey(projectPath, page)];
    writeStore(store);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
