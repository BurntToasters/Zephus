import { describe, it, expect } from "vitest";
import { renderBlockNode } from "../../main/services/schema";
import {
  BLOCK_RENDER_FIXTURES,
  BUILD_MAX_HEADING_LEVEL,
} from "../blockRenderFixtures";
import {
  collectResponsiveCss,
  renderBlockHtml,
  renderSectionsMarkup,
  sectionHasSurface,
  sectionWrapperIsNone,
  shouldUnwrapSectionChildren,
  wrapSectionChildren,
} from "../blockRender";

describe("blockRender sections", () => {
  it("treats missing wrapper as none", () => {
    expect(sectionWrapperIsNone({})).toBe(true);
    expect(sectionWrapperIsNone({ wrapper: "none" })).toBe(true);
    expect(sectionWrapperIsNone({ wrapper: "box" })).toBe(false);
  });

  it("unwraps plain sections without surface", () => {
    const section = {
      id: "s1",
      label: "Main",
      props: {},
      children: [],
    };
    expect(sectionHasSurface(section)).toBe(false);
    expect(shouldUnwrapSectionChildren(section)).toBe(true);
    expect(wrapSectionChildren(section, "<p>x</p>")).toBe("<p>x</p>");
  });

  it("wraps when wrapper is box even without surface", () => {
    const section = {
      id: "s1",
      label: "Hero",
      props: { wrapper: "box" },
    };
    expect(shouldUnwrapSectionChildren(section)).toBe(false);
    const html = wrapSectionChildren(section, "<p>x</p>");
    expect(html).toContain("<section");
    expect(html).toContain('data-zephus-id="s1"');
    expect(html).toContain("<p>x</p>");
  });
});

const SECTION_FIXTURES = [
  {
    label: "unwrap-plain",
    section: {
      id: "sec-plain",
      label: "Main",
      props: { wrapper: "none", cls: "" },
      children: "<p>inner</p>",
    },
  },
  {
    label: "wrap-box",
    section: {
      id: "sec-box",
      label: "Hero",
      props: { wrapper: "box", cls: "hero-shell" },
      style: { padding: "2rem" },
      locked: true,
      children: "<p>hero</p>",
    },
  },
] as const;

import type { SectionNode } from "../../main/types";

const RESPONSIVE_SECTIONS: SectionNode[] = [
  {
    id: "sec-main",
    type: "section",
    label: "Content",
    props: { wrapper: "box", cls: "" },
    children: [
      {
        id: "fix-columns",
        type: "columns",
        props: { count: "2", col1: "Left", col2: "Right", cls: "" },
        style: {
          columns: "2",
          gap: "1rem",
          stackOnMobile: true,
          responsive: { tablet: { gap: "2rem" } },
        },
      },
    ],
  },
];

describe("renderSectionsMarkup parity", () => {
  it("matches build renderBlockNode for responsive sections", () => {
    const build = renderSectionsMarkup(RESPONSIVE_SECTIONS, (block) =>
      renderBlockNode(block),
    );
    const editorSerialize = renderSectionsMarkup(RESPONSIVE_SECTIONS, (block) =>
      renderBlockHtml(block, {
        viewport: "desktop",
        forCanvas: false,
        maxHeadingLevel: BUILD_MAX_HEADING_LEVEL,
      }),
    );
    expect(editorSerialize).toBe(build);
  });
});

describe("collectResponsiveCss", () => {
  it("emits tablet and mobile rules for responsive blocks", () => {
    const css = collectResponsiveCss([
      {
        id: "sec-1",
        type: "section",
        label: "Main",
        props: { wrapper: "none" },
        children: [
          {
            id: "col-1",
            type: "columns",
            props: { count: "2", col1: "A", col2: "B", cls: "" },
            style: {
              columns: "2",
              stackOnMobile: true,
              responsive: {
                tablet: { gap: "1rem" },
                mobile: { padding: "8px" },
              },
            },
          },
        ],
      },
    ]);
    expect(css).toContain("@media (max-width: 1024px)");
    expect(css).toContain("@media (max-width: 720px)");
    expect(css).toContain("data-zephus-id=");
    expect(css).toContain("grid-template-columns:1fr!important");
  });

  it("escapes tricky ids with CSS string rules, not HTML entities", () => {
    // Regression: the selector used escapeAttr (`&amp;`), which stays literal
    // inside <style> — blocks with & " \ in their id never got responsive
    // rules (hidden-on-mobile blocks stayed visible).
    const css = collectResponsiveCss([
      {
        id: 'weird&"id\\x',
        type: "section",
        label: "Main",
        props: { wrapper: "none" },
        style: { responsive: { mobile: { padding: "8px" } } },
        children: [],
      },
    ]);
    expect(css).toContain('[data-zephus-id="weird&\\"id\\\\x"]');
    expect(css).not.toContain("&amp;");
  });

  it("escapes angle brackets in ids so a crafted id cannot break out of <style>", () => {
    // Stored XSS regression: a hand-authored block id containing `</style>`
    // would terminate the raw-text style element mid-selector; a following
    // `<script>` would then run in the published site. The selector must keep
    // matching the real attribute (CSS hex escapes) without emitting a literal
    // angle bracket into the style text.
    const css = collectResponsiveCss([
      {
        id: "x</style><script>alert(1)</script>",
        type: "section",
        label: "Main",
        props: { wrapper: "none" },
        style: { responsive: { mobile: { padding: "8px" } } },
        children: [],
      },
    ]);
    expect(css).not.toContain("</style>");
    expect(css).not.toContain("<script>");
    // Every angle bracket is escaped (CSS hex escape + space terminator);
    // the selector still identifies the real attribute value on match.
    expect(css).toContain('data-zephus-id="x\\3c /style\\3e \\3c script\\3e');
  });

  it("emits the .button class on button blocks (theme pill styling)", () => {
    const html = renderBlockHtml(
      {
        id: "b1",
        type: "button",
        props: { text: "Go", href: "/x", cls: "secondary" },
      },
      {},
    );
    // The global .button rule styles every hero CTA; without it they render
    // as plain accent links.
    expect(html).toContain('class="button secondary"');
  });

  it("emits hide rules so hideOn actually hides in the built site", () => {
    const css = collectResponsiveCss([
      {
        id: "sec-1",
        type: "section",
        label: "Main",
        props: { wrapper: "none" },
        children: [
          {
            id: "block-tablet",
            type: "text",
            props: { text: "x", cls: "" },
            style: { hideOn: ["tablet"] },
          },
          {
            id: "block-mobile",
            type: "text",
            props: { text: "y", cls: "" },
            style: { hideOn: ["mobile"] },
          },
        ],
      },
    ]);
    expect(css).toContain(
      '@media (max-width: 1024px){[data-zephus-id="block-tablet"]{display:none!important}}',
    );
    expect(css).toContain(
      '@media (max-width: 720px){[data-zephus-id="block-mobile"]{display:none!important}}',
    );
    // The mobile rule must not leak into the tablet media query.
    expect(css).not.toContain(
      'block-mobile"]{display:none!important}}@media (max-width: 1024px)',
    );
  });
});

describe("section wrapper snapshots", () => {
  it.each(SECTION_FIXTURES.map((f) => [f.label, f] as const))(
    "wrapSectionChildren %s",
    (_label, { section }) => {
      const { children, ...meta } = section;
      expect(wrapSectionChildren(meta, children)).toMatchSnapshot();
    },
  );
});

describe("editor serialize parity", () => {
  it.each(BLOCK_RENDER_FIXTURES.map((b, i) => [`${b.type}-${i}`, b] as const))(
    "serialize path matches build for %s",
    (_label, block) => {
      const build = renderBlockNode(block);
      const serialize = renderBlockHtml(block, {
        viewport: "desktop",
        forCanvas: false,
        maxHeadingLevel: BUILD_MAX_HEADING_LEVEL,
      });
      expect(serialize).toBe(build);
    },
  );

  it("canvas heading cap can differ from build when repo limits levels", () => {
    const block = BLOCK_RENDER_FIXTURES.find((b) => b.type === "heading")!;
    const capped = renderBlockHtml(
      { ...block, props: { ...block.props, level: "6" } },
      { forCanvas: true, maxHeadingLevel: 4 },
    );
    const build = renderBlockHtml(
      { ...block, props: { ...block.props, level: "6" } },
      { forCanvas: false, maxHeadingLevel: BUILD_MAX_HEADING_LEVEL },
    );
    expect(capped).toContain("<h4");
    expect(build).toContain("<h6");
  });
});
