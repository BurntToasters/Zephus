import { app } from "electron";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import {
  DraftData,
  DraftResult,
  DraftScope,
  DraftSummary,
  DraftSummaryResult,
  OperationResult,
} from "../types";

type DraftStore = Record<string, DraftData>;

function draftsPath(): string {
  return path.join(app.getPath("userData"), "drafts.json");
}

function draftKey(
  projectPath: string,
  scope: DraftScope,
  target: string,
): string {
  if (scope === "page") {
    return crypto
      .createHash("sha1")
      .update(path.resolve(projectPath) + "::" + target)
      .digest("hex");
  }
  return crypto
    .createHash("sha1")
    .update(path.resolve(projectPath) + `::${scope}::` + target)
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

function normalizeDraft(
  draft: DraftData | ({ page: string } & Partial<DraftData>) | null,
  fallbackProjectPath?: string,
  fallbackScope?: DraftScope,
  fallbackTarget?: string,
): DraftData | null {
  if (!draft) return null;
  if ("scope" in draft && "target" in draft && draft.scope && draft.target) {
    return {
      projectPath:
        typeof draft.projectPath === "string"
          ? draft.projectPath
          : (fallbackProjectPath ?? ""),
      scope: draft.scope,
      target: draft.target,
      content: draft.content ?? "",
      savedAt: draft.savedAt ?? new Date(0).toISOString(),
    };
  }
  if ("page" in draft && typeof draft.page === "string") {
    return {
      projectPath: fallbackProjectPath ?? "",
      scope: fallbackScope ?? "page",
      target: fallbackTarget ?? draft.page,
      content: draft.content ?? "",
      savedAt: draft.savedAt ?? new Date(0).toISOString(),
    };
  }
  return null;
}

function writeStore(store: DraftStore): void {
  const file = draftsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2) + "\n", "utf8");
}

export function readDraft(
  projectPath: string,
  scope: DraftScope,
  target: string,
): DraftResult {
  try {
    const draft = normalizeDraft(
      readStore()[draftKey(projectPath, scope, target)] ?? null,
      projectPath,
      scope,
      target,
    );
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
  scope: DraftScope,
  target: string,
  content: string,
): OperationResult {
  try {
    const store = readStore();
    store[draftKey(projectPath, scope, target)] = {
      projectPath,
      scope,
      target,
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

export function listDraftSummaries(): DraftSummaryResult {
  try {
    const entries = Object.values(readStore())
      .map((entry) => normalizeDraft(entry, "", "page", ""))
      .filter((entry): entry is DraftData =>
        Boolean(entry?.projectPath && entry.target && entry.savedAt),
      )
      .map(
        (entry): DraftSummary => ({
          projectPath: entry.projectPath,
          scope: entry.scope,
          target: entry.target,
          savedAt: entry.savedAt,
        }),
      )
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    return { ok: true, entries };
  } catch (error) {
    return {
      ok: false,
      entries: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function clearDraft(
  projectPath: string,
  scope: DraftScope,
  target: string,
): OperationResult {
  try {
    const store = readStore();
    delete store[draftKey(projectPath, scope, target)];
    writeStore(store);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
