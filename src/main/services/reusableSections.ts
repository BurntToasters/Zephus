import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import {
  OperationResult,
  ReusableSection,
  ReusableSectionsResult,
} from "../types";
import {
  assertRealpathInside,
  readJsonSafe,
  safeResolve,
  writeFileAtomic,
} from "./fsSafe";

function assertContainedTarget(
  projectPath: string,
  relParts: string[],
): string {
  const root = path.resolve(projectPath);
  const realRoot = fs.realpathSync.native(root);
  let current = root;
  for (const part of relParts) {
    current = safeResolve(current, part);
    let st: fs.Stats | null;
    try {
      st = fs.lstatSync(current);
    } catch {
      st = null;
    }
    if (st) {
      if (st.isSymbolicLink() && !fs.existsSync(current)) {
        throw new Error("Path escapes the project directory.");
      }
      assertRealpathInside(realRoot, current);
    }
  }
  assertRealpathInside(realRoot, current);
  return current;
}

/** Reusable sections are stored in the project and travel with it. */
function sectionsPath(projectPath: string): string {
  return assertContainedTarget(projectPath, [
    ".zephus",
    "templates",
    "reusable-sections.json",
  ]);
}

function legacySectionsPath(): string {
  return path.join(app.getPath("userData"), "reusable-sections.json");
}

function readSectionsFile(file: string): ReusableSection[] {
  if (!fs.existsSync(file)) return [];
  const { data } = readJsonSafe<ReusableSection[]>(file);
  if (!Array.isArray(data)) return [];
  // A valid-JSON-but-malformed entry (missing label/html) must not crash the
  // list handler or produce garbage in the palette.
  return data.filter(
    (section) =>
      typeof section?.id === "string" &&
      typeof section?.label === "string" &&
      typeof section?.html === "string",
  );
}

function writeSectionsFile(
  projectPath: string,
  file: string,
  sections: ReusableSection[],
): void {
  const realRoot = fs.realpathSync.native(path.resolve(projectPath));
  assertRealpathInside(realRoot, path.dirname(file));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  assertRealpathInside(realRoot, path.dirname(file));
  const verifiedFile = sectionsPath(projectPath);
  writeFileAtomic(verifiedFile, JSON.stringify(sections, null, 2) + "\n");
}

function readStoredSections(projectPath: string): ReusableSection[] {
  const file = sectionsPath(projectPath);
  const sections = readSectionsFile(file);
  if (sections.length > 0) return sections;
  // An EXISTING but empty project store means the user deleted every saved
  // section — do NOT re-migrate from the legacy global store (previously the
  // migration re-triggered on the next read and resurrected the deleted
  // sections). Only migrate when the project store was never created.
  if (fs.existsSync(file)) return sections;
  const legacy = readSectionsFile(legacySectionsPath());
  if (legacy.length === 0) return [];
  writeSectionsFile(projectPath, file, legacy);
  return legacy;
}

export function writeStoredReusableSections(
  projectPath: string,
  sections: ReusableSection[],
): OperationResult {
  try {
    const file = sectionsPath(projectPath);
    writeSectionsFile(projectPath, file, sections);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function listReusableSections(
  projectPath: string,
): ReusableSectionsResult {
  try {
    return {
      ok: true,
      sections: readStoredSections(projectPath).sort((a, b) =>
        a.label.localeCompare(b.label),
      ),
    };
  } catch (error) {
    return {
      ok: false,
      sections: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function saveReusableSection(
  projectPath: string,
  label: string,
  html: string,
): ReusableSectionsResult {
  const trimmedLabel = label.trim();
  const trimmedHtml = html.trim();
  if (!trimmedLabel || !trimmedHtml) {
    return { ok: false, sections: [], error: "Label and HTML are required." };
  }
  try {
    const sections = readStoredSections(projectPath);
    const now = new Date().toISOString();
    const existing = sections.find((section) => section.label === trimmedLabel);
    if (existing) {
      existing.html = trimmedHtml;
      existing.updatedAt = now;
    } else {
      sections.push({
        id: "section-" + Math.random().toString(36).slice(2, 10),
        label: trimmedLabel,
        html: trimmedHtml,
        updatedAt: now,
      });
    }
    writeSectionsFile(projectPath, sectionsPath(projectPath), sections);
    return { ok: true, sections };
  } catch (error) {
    return {
      ok: false,
      sections: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function deleteReusableSection(
  projectPath: string,
  id: string,
): OperationResult {
  try {
    const sections = readStoredSections(projectPath);
    const next = sections.filter((section) => section.id !== id);
    writeSectionsFile(projectPath, sectionsPath(projectPath), next);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
