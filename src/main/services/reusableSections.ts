import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import { OperationResult, ReusableSection, ReusableSectionsResult } from "../types";

function sectionsPath(): string {
  return path.join(app.getPath("userData"), "reusable-sections.json");
}

function readStoredSections(): ReusableSection[] {
  const file = sectionsPath();
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as ReusableSection[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStoredSections(sections: ReusableSection[]): void {
  const file = sectionsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(sections, null, 2) + "\n", "utf8");
}

export function listReusableSections(): ReusableSectionsResult {
  return {
    ok: true,
    sections: readStoredSections().sort((a, b) => a.label.localeCompare(b.label)),
  };
}

export function saveReusableSection(
  label: string,
  html: string,
): ReusableSectionsResult {
  const trimmedLabel = label.trim();
  const trimmedHtml = html.trim();
  if (!trimmedLabel || !trimmedHtml) {
    return { ok: false, sections: [], error: "Label and HTML are required." };
  }
  const sections = readStoredSections();
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
  writeStoredSections(sections);
  return { ok: true, sections };
}

export function deleteReusableSection(id: string): OperationResult {
  const sections = readStoredSections();
  const next = sections.filter((section) => section.id !== id);
  writeStoredSections(next);
  return { ok: true };
}
