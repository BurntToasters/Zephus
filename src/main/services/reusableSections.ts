import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import {
  OperationResult,
  ReusableSection,
  ReusableSectionsResult,
} from "../types";
import { readJsonSafe, writeFileAtomic } from "./fsSafe";

/**
 * Reusable sections are stored inside the project (`.zephus/templates/
 * reusable-sections.json`) so they travel with the site when it is committed
 * to Git — matching the rest of the Zephus save state. Pre-0.1.0 installs
 * stored them globally in the app user-data directory; that store is migrated
 * into the project on first read.
 */
function sectionsPath(projectPath: string): string {
  return path.join(
    projectPath,
    ".zephus",
    "templates",
    "reusable-sections.json",
  );
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

function writeSectionsFile(file: string, sections: ReusableSection[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomic(file, JSON.stringify(sections, null, 2) + "\n");
}

function readStoredSections(projectPath: string): ReusableSection[] {
  const file = sectionsPath(projectPath);
  const sections = readSectionsFile(file);
  if (sections.length > 0) return sections;
  // One-time migration from the legacy global store.
  const legacy = readSectionsFile(legacySectionsPath());
  if (legacy.length === 0) return [];
  writeSectionsFile(file, legacy);
  return legacy;
}

export function listReusableSections(
  projectPath: string,
): ReusableSectionsResult {
  return {
    ok: true,
    sections: readStoredSections(projectPath).sort((a, b) =>
      a.label.localeCompare(b.label),
    ),
  };
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
  writeSectionsFile(sectionsPath(projectPath), sections);
  return { ok: true, sections };
}

export function deleteReusableSection(
  projectPath: string,
  id: string,
): OperationResult {
  const sections = readStoredSections(projectPath);
  const next = sections.filter((section) => section.id !== id);
  writeSectionsFile(sectionsPath(projectPath), next);
  return { ok: true };
}
