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
    /([\s\S]*<body[^>]*>)([\s\S]*?)(<\/body>[\s\S]*)/i,
  );
  let inner: string;
  if (bodyMatch) {
    frame.prefix = bodyMatch[1] ?? "";
    inner = bodyMatch[2] ?? "";
    frame.suffix = bodyMatch[3] ?? "";
  } else {
    const rootMatch = rest.match(
      /^(\s*<([A-Za-z][\w.-]*)\b[^>]*>)([\s\S]*)(<\/\2>\s*)$/,
    );
    if (rootMatch) {
      frame.prefix = rootMatch[1] ?? "";
      inner = rootMatch[3] ?? "";
      frame.suffix = rootMatch[4] ?? "";
    } else {
      inner = rest;
    }
  }

  return { frame, inner };
}

/** Indents each non-empty line of managed inner HTML (default: 4 spaces). */
export function indentManagedBody(core: string, indent = "    "): string {
  return core
    .split("\n")
    .map((line) => (line ? `${indent}${line}` : line))
    .join("\n");
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
