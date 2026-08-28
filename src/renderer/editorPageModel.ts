/**
 * Pure helpers for the editor's in-memory page/section model (no DOM).
 */

import type { EditorBlock, PageDocument, SectionNode } from "../main/types";

export function cloneSections(sections: SectionNode[]): SectionNode[] {
  return JSON.parse(JSON.stringify(sections)) as SectionNode[];
}

export function blocksFromSections(sections: SectionNode[]): EditorBlock[] {
  return sections.flatMap((section) =>
    section.children.map((child) => ({
      id: child.id,
      type: child.type,
      props: { ...child.props },
      style: child.style ? JSON.parse(JSON.stringify(child.style)) : undefined,
      locked: child.locked,
      raw: child.raw,
    })),
  );
}

export function buildPageDocumentFromSections(
  base: PageDocument,
  page: string,
  sections: SectionNode[],
): PageDocument {
  return {
    ...base,
    page,
    sections: cloneSections(sections),
  };
}
