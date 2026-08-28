import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createSite } from "../wizard";
import { renamePage } from "../pageManager";
import {
  ensureVisualSchema,
  createSchemaPage,
  writePageDocument,
  readPageDocument,
  pagePathFromSlug,
} from "../schema";

let tmpDir: string;
let project: string;
const pagesDir = "src/pages";

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-postlist-"));
  project = path.join(tmpDir, "site");
  fs.mkdirSync(project);
  const created = createSite(project, "minimal");
  expect(created.ok).toBe(true);
  ensureVisualSchema(project, pagesDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function addPostlistPage(): string {
  createSchemaPage(project, pagesDir, "list-page");
  const rel = pagePathFromSlug(pagesDir, "list-page");
  const current = readPageDocument(project, rel, pagesDir);
  const wrote = writePageDocument(project, pagesDir, {
    ...current.pageDocument!,
    sections: [
      {
        id: "s1",
        type: "section",
        label: "Main",
        props: { wrapper: "none", cls: "" },
        children: [
          {
            id: "pl",
            type: "postlist",
            props: {
              folder: "/",
              showDate: "true",
              showAuthor: "true",
              showExcerpt: "true",
              showImage: "false",
              emptyText: "None",
              cls: "",
            },
          },
        ],
      },
    ],
  });
  expect(wrote.ok).toBe(true);
  return rel;
}

describe("post list refresh", () => {
  it("renders posts into a postlist page at save time", () => {
    createSchemaPage(project, pagesDir, "post-a");
    const rel = addPostlistPage();
    const html = fs.readFileSync(path.join(project, rel), "utf8");
    expect(html).toContain('class="zephus-postlist"');
    expect(html).toContain("/post-a");
    expect(html).not.toContain("zephus-postlist-empty");
  });

  it("refreshes other pages' postlists when a post is renamed", () => {
    createSchemaPage(project, pagesDir, "post-old");
    const rel = addPostlistPage();
    const renamed = renamePage(
      project,
      path.join(pagesDir, "post-old.astro"),
      pagesDir,
      "post-new",
    );
    expect(renamed.ok).toBe(true);
    const html = fs.readFileSync(path.join(project, rel), "utf8");
    expect(html).toContain("/post-new");
    expect(html).not.toContain('href="/post-old"');
  });

  it("shows the empty state when no posts match the folder", () => {
    createSchemaPage(project, pagesDir, "list-page");
    const rel = pagePathFromSlug(pagesDir, "list-page");
    const current = readPageDocument(project, rel, pagesDir);
    writePageDocument(project, pagesDir, {
      ...current.pageDocument!,
      sections: [
        {
          id: "s1",
          type: "section",
          label: "Main",
          props: { wrapper: "none", cls: "" },
          children: [
            {
              id: "pl",
              type: "postlist",
              props: {
                folder: "/no-such-folder",
                showDate: "false",
                showAuthor: "false",
                showExcerpt: "false",
                showImage: "false",
                emptyText: "None",
                cls: "",
              },
            },
          ],
        },
      ],
    });
    const html = fs.readFileSync(path.join(project, rel), "utf8");
    expect(html).toContain("zephus-postlist-empty");
    expect(html).toContain("None");
  });
});
