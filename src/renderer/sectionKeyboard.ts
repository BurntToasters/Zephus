const SECTION_MOVE_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

export interface SectionMoveSection {
  blockCount: number;
}

export type SectionMoveResult =
  { kind: "block"; index: number } | { kind: "section"; index: number };

export function isSectionMoveKey(key: string): boolean {
  return SECTION_MOVE_KEYS.has(key);
}

function flatIndex(
  sections: readonly SectionMoveSection[],
  sectionIndex: number,
  blockOffset: number,
): number {
  let index = blockOffset;
  for (let i = 0; i < sectionIndex; i += 1) {
    index += sections[i]?.blockCount ?? 0;
  }
  return index;
}

function firstBlockIndex(
  sections: readonly SectionMoveSection[],
  sectionIndex: number,
): number | null {
  const count = sections[sectionIndex]?.blockCount ?? 0;
  if (count <= 0) return null;
  return flatIndex(sections, sectionIndex, 0);
}

function lastBlockIndex(
  sections: readonly SectionMoveSection[],
  sectionIndex: number,
): number | null {
  const count = sections[sectionIndex]?.blockCount ?? 0;
  if (count <= 0) return null;
  return flatIndex(sections, sectionIndex, count - 1);
}

/**
 * Where a focused section should go. Down enters that section's first block,
 * or the next section when this one is empty. Up enters the previous
 * section's last block. Home and End jump to the ends of the page.
 */
export function sectionMoveTarget(
  sections: readonly SectionMoveSection[],
  sectionIndex: number,
  key: string,
): SectionMoveResult | null {
  if (!isSectionMoveKey(key)) return null;
  if (sectionIndex < 0 || sectionIndex >= sections.length) return null;

  if (key === "Home") {
    for (let index = 0; index < sections.length; index += 1) {
      const block = firstBlockIndex(sections, index);
      if (block !== null) return { kind: "block", index: block };
    }
    return sectionIndex === 0 ? null : { kind: "section", index: 0 };
  }

  if (key === "End") {
    for (let index = sections.length - 1; index >= 0; index -= 1) {
      const block = lastBlockIndex(sections, index);
      if (block !== null) return { kind: "block", index: block };
    }
    const last = sections.length - 1;
    return sectionIndex === last ? null : { kind: "section", index: last };
  }

  if (key === "ArrowDown") {
    const here = firstBlockIndex(sections, sectionIndex);
    if (here !== null) return { kind: "block", index: here };
    for (let index = sectionIndex + 1; index < sections.length; index += 1) {
      const block = firstBlockIndex(sections, index);
      if (block !== null) return { kind: "block", index: block };
    }
    if (sectionIndex + 1 < sections.length) {
      return { kind: "section", index: sectionIndex + 1 };
    }
    return null;
  }

  for (let index = sectionIndex - 1; index >= 0; index -= 1) {
    const block = lastBlockIndex(sections, index);
    if (block !== null) return { kind: "block", index: block };
  }
  if (sectionIndex > 0) return { kind: "section", index: sectionIndex - 1 };
  return null;
}
