/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { parseSectionsFromSource } from "../../main/services/schema";
import type { BlockNode, SectionNode } from "../../main/types";
import { KNOWN_BLOCK_TYPES } from "../../renderer/editorBlocks";
import { createEditorPageParser } from "../../renderer/editorParse";
import {
  assembleManagedPage,
  splitManagedPageSource,
} from "../../renderer/editorSerialize";
import {
  BUILD_MAX_HEADING_LEVEL,
  BLOCK_RENDER_FIXTURES,
} from "../blockRenderFixtures";
import { renderBlockHtml } from "../blockRender";

const FRAME = {
  frontmatter: `---
import BaseLayout from '../layouts/BaseLayout.astro';
// zephus:managed schema=.zephus/pages/roundtrip.json
---
`,
  prefix: '<BaseLayout title="Round trip">',
  suffix: "</BaseLayout>",
};

let uid = 0;
const parser = createEditorPageParser({
  uid: () => `generated-${++uid}`,
  createFallbackSection: (): SectionNode => ({
    id: `fallback-${++uid}`,
    type: "section",
    label: "Main Content",
    props: { wrapper: "none", cls: "" },
    children: [],
  }),
  knownBlockTypes: KNOWN_BLOCK_TYPES,
});

const typedFixtures = BLOCK_RENDER_FIXTURES.filter(
  (block) => block.type !== "html",
);

function renderManagedFixture(block: BlockNode): string {
  const section: SectionNode = {
    id: "roundtrip-section",
    type: "section",
    label: "Round trip",
    props: { wrapper: "box", cls: "roundtrip-shell" },
    children: [block],
  };
  return assembleManagedPage(FRAME, [section], (candidate) =>
    renderBlockHtml(candidate, {
      viewport: "desktop",
      forCanvas: false,
      maxHeadingLevel: BUILD_MAX_HEADING_LEVEL,
    }),
  );
}

function expectFixtureBlock(tree: SectionNode[], original: BlockNode): void {
  const parsed = tree.find((section) => section.id === "roundtrip-section")
    ?.children[0];
  expect(parsed).toBeDefined();
  const expected: Partial<BlockNode> = {
    id: original.id,
    type: original.type,
    props: original.props,
  };
  if (original.style !== undefined) expected.style = original.style;
  if (original.locked !== undefined) expected.locked = original.locked;
  expect(parsed).toEqual(expect.objectContaining(expected));
}

describe("typed block render → serialize → parse round trips", () => {
  it.each(
    typedFixtures.map(
      (block, index) => [`${block.type}-${index}`, block] as const,
    ),
  )("preserves %s through both parsers", (_label, original) => {
    const source = renderManagedFixture(original);
    const { inner } = splitManagedPageSource(source);

    expectFixtureBlock(parseSectionsFromSource(source), original);
    expectFixtureBlock(parser.parseSections(inner), original);
  });

  it("documents the intentional raw HTML exception", () => {
    const original = BLOCK_RENDER_FIXTURES.find(
      (block) => block.type === "html",
    );
    expect(original).toBeDefined();
    const source = renderManagedFixture(original!);
    const parsed = parseSectionsFromSource(source);
    const block = parsed.find((section) => section.id === "roundtrip-section")
      ?.children[0];

    // Raw HTML is deliberately emitted verbatim without Zephus metadata. It
    // remains editable as an HTML block, but its generated id/props cannot be
    // recovered like typed blocks can.
    expect(block?.type).toBe("html");
    expect(block?.raw).toContain("raw <b>html</b>");
  });
});
