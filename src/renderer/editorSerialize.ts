import type { BlockNode, SectionNode } from "../main/types";
import { renderSectionsMarkup } from "../shared/blockRender";

export interface ManagedPageFrame {
  frontmatter: string;
  prefix: string;
  suffix: string;
}

export interface SplitManagedPage {
  frame: ManagedPageFrame;
  /** Editable inner HTML between prefix and suffix. */
  inner: string;
}

/** Quote-aware tag matcher: a `>` inside a quoted attribute must not end the
 *  tag (mirrors the main-process parser). */
const TAG_PATTERN_SOURCE = "(?:[^>\"']|\"[^\"]*\"|'[^']*')*>";

/**
 * Splits raw managed page source into Astro frontmatter, outer frame, and inner
 * HTML (the region Zephus parses into sections/blocks).
 */
export function splitManagedPageSource(raw: string): SplitManagedPage {
  const frame: ManagedPageFrame = {
    frontmatter: "",
    prefix: "",
    suffix: "",
  };

  let rest = raw;
  const fm = raw.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n?)/);
  if (fm?.[1]) {
    frame.frontmatter = fm[1];
    rest = raw.slice(fm[1].length);
  }

  const bodyMatch = rest.match(
    new RegExp(
      `([\\s\\S]*?<body\\b${TAG_PATTERN_SOURCE})([\\s\\S]*?)(<\\/body>[\\s\\S]*)`,
      "i",
    ),
  );
  let inner: string;
  if (bodyMatch) {
    frame.prefix = bodyMatch[1] ?? "";
    inner = bodyMatch[2] ?? "";
    frame.suffix = bodyMatch[3] ?? "";
  } else {
    // Generic root wrapper (e.g. <BaseLayout>): case-insensitive on both the
    // open and close tags, matching extractManagedInner in the main process.
    // The LAST closing tag ends the frame; content after it is hand-authored
    // and stays part of the editable inner.
    const rootMatch = rest.match(
      new RegExp(
        `^(\\s*<([A-Za-z][\\w.-]*)\\b${TAG_PATTERN_SOURCE})([\\s\\S]*)`,
        "i",
      ),
    );
    const openEnd = rootMatch?.[1]?.length ?? 0;
    const openName = rootMatch?.[2];
    const lastClose = openName
      ? [...rest.matchAll(new RegExp(`</${openName}\\s*>`, "gi"))].pop()
      : undefined;
    if (
      rootMatch &&
      lastClose &&
      lastClose.index !== undefined &&
      lastClose.index >= openEnd &&
      /^\s*$/.test(rest.slice(lastClose.index + lastClose[0].length))
    ) {
      frame.prefix = rootMatch[1] ?? "";
      inner = rest.slice(openEnd, lastClose.index);
      frame.suffix = rest.slice(lastClose.index);
    } else {
      inner = rest;
    }
  }

  return { frame, inner };
}

/** Indents each non-empty line of managed inner HTML (default: 4 spaces). */
// MUST match the main process serializer (renderAstroPage indents the body
// two spaces). The renderer's assembleManagedPage previously used four, so
// its output never byte-matched the disk source: after a managed code-mode
// save the refill rewrote the editor to 2-space output, and the NEXT save
// (with zero edits) saw content !== managedSource and silently DETACHED the
// page into hand-authored mode.
export function indentManagedBody(core: string, indent = "  "): string {
  return (
    core
      .split("\n")
      .map((line) => (line ? `${indent}${line}` : line))
      .join("\n")
      // Restore real newlines inside html-block raws AFTER the indent so their
      // interior lines never accumulate the serializer's prefix.
      .replace(/\uE000/g, "\n")
  );
}

/** Builds full managed page source from frame + sections (matches editor serialize). */
export function assembleManagedPage(
  frame: ManagedPageFrame,
  sections: SectionNode[],
  renderBlock: (block: BlockNode) => string,
): string {
  const core = renderSectionsMarkup(sections, renderBlock);
  const body = indentManagedBody(core);
  return `${frame.frontmatter}${frame.prefix}\n${body}\n${frame.suffix}`;
}
