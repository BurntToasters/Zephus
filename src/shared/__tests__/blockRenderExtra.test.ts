import { describe, it, expect, vi } from "vitest";
import {
  renderBlockHtml,
  selectPostEntries,
  renderSectionsMarkup,
} from "../blockRender";
import { BLOCK_RENDER_FIXTURES } from "../blockRenderFixtures";
import type { BlockNode, SectionNode } from "../../main/types";

const POSTS = [
  {
    route: "/posts/one",
    title: "One",
    description: "D1",
    date: "2026-02-01",
    author: "A",
    image: "/assets/one.png",
  },
  {
    route: "/posts/two",
    title: "Two",
    description: "D2",
    date: "2026-03-01",
    author: "B",
    image: "",
  },
  {
    route: "/posts/draft",
    title: "Draft",
    description: "D3",
    date: "",
    author: "",
    image: "",
  },
];

describe("selectPostEntries", () => {
  it("filters by route prefix and sorts newest first", () => {
    const entries = selectPostEntries({ folder: "/posts" }, POSTS);
    expect(entries.map((e) => e.route)).toEqual([
      "/posts/two",
      "/posts/one",
      "/posts/draft",
    ]);
  });

  it("honors the limit", () => {
    const entries = selectPostEntries({ folder: "/posts", limit: "2" }, POSTS);
    expect(entries).toHaveLength(2);
  });

  it("matches a root folder to all non-home routes", () => {
    const entries = selectPostEntries({ folder: "/" }, POSTS);
    expect(entries).toHaveLength(3);
  });

  it("ignores non-numeric limits", () => {
    const entries = selectPostEntries(
      { folder: "/posts", limit: "abc" },
      POSTS,
    );
    expect(entries).toHaveLength(3);
  });
});

describe("renderBlockHtml postlist", () => {
  const listBlock = (props: Record<string, string>): BlockNode => ({
    id: "pl1",
    type: "postlist",
    props,
  });

  it("renders dated posts with meta when enabled", () => {
    const html = renderBlockHtml(
      listBlock({
        folder: "/posts",
        showDate: "true",
        showAuthor: "true",
        showExcerpt: "true",
        showImage: "true",
        cls: "",
      }),
      { posts: POSTS },
    );
    expect(html).toContain("zephus-postlist-item");
    expect(html).toContain("Two");
    expect(html).toContain('datetime="2026-03-01"');
    expect(html).toContain("zephus-postlist-author");
    expect(html).toContain("zephus-postlist-image");
    expect(html).toContain("zephus-postlist-excerpt");
    expect(html).toContain("March 1, 2026");
  });

  it("omits meta when toggled off", () => {
    const html = renderBlockHtml(
      listBlock({
        folder: "/posts",
        showDate: "false",
        showAuthor: "false",
        showExcerpt: "false",
        showImage: "false",
        cls: "",
      }),
      { posts: POSTS },
    );
    expect(html).not.toContain("zephus-postlist-date");
    expect(html).not.toContain("zephus-postlist-author");
    expect(html).not.toContain("zephus-postlist-image");
    expect(html).not.toContain("zephus-postlist-excerpt");
  });

  it("renders the empty state with custom text", () => {
    const html = renderBlockHtml(
      listBlock({
        folder: "/nowhere",
        emptyText: "Nothing here yet.",
        cls: "",
      }),
      { posts: POSTS },
    );
    expect(html).toContain("Nothing here yet.");
  });

  it("escapes post content", () => {
    const html = renderBlockHtml(listBlock({ folder: "/posts", cls: "" }), {
      posts: [
        {
          route: "/posts/x",
          title: "<script>evil()</script>",
          description: "A & B",
          date: "2026-02-01",
          author: "X",
          image: "",
        },
      ],
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("A &amp; B");
  });
});

describe("renderBlockHtml video", () => {
  it("renders a video element with safe src", () => {
    const html = renderBlockHtml({
      id: "v1",
      type: "video",
      props: { src: "https://example.com/m.mp4", title: "Demo", cls: "" },
    });
    expect(html).toContain("<video");
    expect(html).toContain('src="https://example.com/m.mp4"');
    expect(html).toContain("controls");
    expect(html).toContain('title="Demo"');
  });

  it("shows an empty state on the canvas without a src", () => {
    const html = renderBlockHtml(
      { id: "v1", type: "video", props: { src: "", title: "", cls: "" } },
      { forCanvas: true },
    );
    expect(html).toContain("canvas-empty");
    expect(html).toContain("Missing video URL");
  });

  it("blocks unsafe schemes in the src", () => {
    const html = renderBlockHtml({
      id: "v1",
      type: "video",
      props: { src: "java" + "script:alert(1)", title: "", cls: "" },
    });
    expect(html).not.toContain("java" + "script:");
    expect(html).toContain('src=""');
  });
});

describe("renderBlockHtml unknown block", () => {
  it("renders a placeholder on the canvas", () => {
    const html = renderBlockHtml(
      { id: "u1", type: "mystery" as never, props: {} },
      { forCanvas: true },
    );
    expect(html).toContain("canvas-unknown-block");
  });

  it("emits a metadata comment for the build and calls the callback", () => {
    const onUnknown = vi.fn();
    const html = renderBlockHtml(
      { id: "u1", type: "mystery" as never, props: { a: "b" } },
      { onUnknownBlockType: onUnknown },
    );
    expect(onUnknown).toHaveBeenCalledWith("mystery");
    expect(html).toContain("Unknown block type");
    expect(html).toContain('data-zephus-block="mystery"');
  });
});

describe("renderSectionsMarkup", () => {
  it("emits responsive css before the body", () => {
    const sections: SectionNode[] = [
      {
        id: "s1",
        type: "section",
        label: "Main",
        props: { wrapper: "none", cls: "" },
        children: [
          {
            id: "b1",
            type: "text",
            props: { text: "x", cls: "" },
            style: { responsive: { mobile: { padding: "4px" } } },
          },
        ],
      },
    ];
    const html = renderSectionsMarkup(sections, (block) =>
      renderBlockHtml(block),
    );
    expect(html).toMatch(/^<style>@media/);
    expect(html).toContain('[data-zephus-id="b1"]{padding:4px!important}');
    expect(html).toContain("<p");
  });
});

describe("canvas vs build parity", () => {
  it("produces identical markup for desktop-styled blocks", () => {
    // The build and the editor canvas must serialize the same content: a
    // divergence means what the user sees is not what gets published. Only
    // blocks with responsive/hideOn styling or missing sources may differ.
    // data-asset-src is a canvas-only indirection for local asset previews;
    // strip it (and its src="" placeholder) before comparing.
    const normalize = (html: string): string =>
      html
        // Canvas swaps src="…" for a transparent placeholder (single image)
        // or src="" (gallery) + data-asset-src; fold both back.
        .replace(
          /\ssrc="(?:data:image\/gif;base64,[^"]*|)"\s*data-asset-src="([^"]*)"/g,
          ' src="$1"',
        )
        .replace(/\s*data-asset-src="[^"]*"/g, "");
    for (const fixture of BLOCK_RENDER_FIXTURES) {
      const build = renderBlockHtml(fixture, {});
      const canvas = renderBlockHtml(fixture, { forCanvas: true });
      expect(normalize(canvas)).toBe(normalize(build));
    }
  });

  it("keeps hidden-on-desktop blocks visible on the canvas", () => {
    const block: BlockNode = {
      id: "hide-me",
      type: "text",
      props: { text: "x", cls: "" },
      style: { hideOn: ["desktop"] },
    };
    const build = renderBlockHtml(block, {});
    const canvas = renderBlockHtml(block, { forCanvas: true });
    expect(build).toContain("display:none");
    expect(canvas).not.toContain("display:none");
  });
});
