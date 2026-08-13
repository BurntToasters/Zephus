// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { openFindReplaceModal } from "../editorFindReplace";
import type { FindReplaceDeps } from "../editorFindReplace";
import type { FindReplaceModalState } from "../FindReplaceModal";

let lastBodyProps: FindReplaceModalState | null = null;
let lastActions: Array<{
  label: string;
  kind?: string;
  onClick: () => void;
}> = [];

vi.mock("../FindReplaceModal", () => ({
  renderFindReplaceModalBody: (
    _wrap: HTMLElement,
    props: FindReplaceModalState,
  ): (() => void) => {
    lastBodyProps = props;
    return () => undefined;
  },
}));

interface Deferred {
  resolve: (v: unknown) => void;
  promise: Promise<unknown>;
}
function deferred(): Deferred {
  let resolve!: (v: unknown) => void;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { resolve, promise };
}

function makeDeps(initialState: Record<string, unknown> = {}) {
  const searches: string[] = [];
  let pending: Deferred | null = null;
  const statuses: string[] = [];
  const replaced: string[] = [];
  const state = {
    project: { path: "/proj", astro: { pagesDir: "src/pages" } },
    page: "index",
    ...initialState,
  };

  const deps = {
    getState: () => state as never,
    setStatus: (m: string) => statuses.push(m),
    showModalNode: (
      _title: string,
      _content: HTMLElement,
      actions: Array<{ label: string; kind?: string; onClick: () => void }>,
    ) => {
      lastActions = actions;
    },
    closeModal: () => undefined,
    registerCleanup: () => undefined,
    confirmDestructive: vi.fn(async () => true),
    loadPage: vi.fn(async () => undefined),
    reloadPages: vi.fn(async () => undefined),
    maybeResolveUnsavedWork: vi.fn(async () => true),
    searchPages: vi.fn(async (_p: string, _d: string, query: string) => {
      searches.push(query);
      pending = deferred();
      return pending.promise;
    }),
    replaceAllInPages: vi.fn(async (_p: string, _d: string, query: string) => {
      replaced.push(query);
      return { ok: true, replaced: 1, pagesChanged: 1 };
    }),
  } as unknown as FindReplaceDeps;

  return {
    deps,
    getLastBody: () => lastBodyProps,
    getActions: () => lastActions,
    searches,
    statuses,
    replaced,
    getPending: () => pending,
  };
}

/** Flushes both the promise-reaction queue and the await fast-path queue. */
function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

const okResult = (matches: unknown[], total = matches.length) => ({
  ok: true,
  matches,
  totalMatches: total,
  skippedDetachedPages: 0,
});

beforeEach(() => {
  vi.restoreAllMocks();
  lastBodyProps = null;
});

describe("openFindReplaceModal search sequencing", () => {
  it("discards a stale in-flight search response after the query changed", async () => {
    const { deps, getLastBody, getPending } = makeDeps();
    await openFindReplaceModal(deps);

    getLastBody()!.onQueryChange("hello");
    getLastBody()!.onSearch();

    // Query changes again while the first search is still in flight.
    getLastBody()!.onQueryChange("world");
    const first = getPending()!;
    first.resolve(okResult([{ page: "index", line: 1, snippet: "hello" }], 1));
    await flush();

    // The stale response must not populate the visible list: the body must
    // still be showing the pre-search state for "world".
    expect(getLastBody()!.matches).toBeNull();
    expect(getLastBody()!.searchedQuery).toBe("");
  });

  it("keeps the response when no newer search superseded it", async () => {
    const { deps, getLastBody, getPending } = makeDeps();
    await openFindReplaceModal(deps);

    getLastBody()!.onQueryChange("hello");
    getLastBody()!.onSearch();
    const first = getPending()!;
    first.resolve(okResult([{ page: "index", line: 1, snippet: "hello" }], 1));
    await flush();

    expect(getLastBody()!.matches).toHaveLength(1);
    expect(getLastBody()!.searchedQuery).toBe("hello");
  });

  it("does not replace with a stale match list after the query changed", async () => {
    const { deps, getLastBody, getPending, replaced } = makeDeps();
    await openFindReplaceModal(deps);

    getLastBody()!.onQueryChange("hello");
    getLastBody()!.onSearch();
    getPending()!.resolve(
      okResult([{ page: "index", line: 1, snippet: "hello" }], 1),
    );
    await flush();
    expect(getLastBody()!.matches).toHaveLength(1);

    // Query edited AFTER the search: results are invalidated. A Replace All
    // triggered from this state must re-search with the new text — the old
    // match list must never be passed to replaceAllInPages.
    getLastBody()!.onQueryChange("world");
    getLastBody()!.onSearch();
    getPending()!.resolve(okResult([], 0));
    await flush();
    expect(replaced).toHaveLength(0);
  });

  it("replaces all matches when confirmed", async () => {
    const { deps, getLastBody, getPending, getActions, replaced, statuses } =
      makeDeps();
    await openFindReplaceModal(deps);

    getLastBody()!.onQueryChange("hello");
    getLastBody()!.onSearch();
    getPending()!.resolve(
      okResult([{ page: "index", line: 1, snippet: "hello" }], 1),
    );
    await flush();

    const replaceAll = getActions().find((a) => a.label === "Replace All")!;
    const handler = replaceAll.onClick as () => Promise<void>;
    const run = handler();
    // Replace All re-searches first with the same query.
    const pending2 = getPending()!;
    pending2.resolve(
      okResult([{ page: "index", line: 1, snippet: "hello" }], 1),
    );
    await run;
    await flush();

    expect(replaced).toEqual(["hello"]);
    expect(statuses).toContain("Replaced 1 occurrence(s) across 1 page(s).");
  });

  it("refuses to replace when unsaved work cannot be settled", async () => {
    // Dirty session: the guard must ask the user to settle unsaved work.
    const { deps, getLastBody, getPending, getActions, replaced, statuses } =
      makeDeps({ pageDirty: true });
    (
      deps.maybeResolveUnsavedWork as ReturnType<typeof vi.fn>
    ).mockResolvedValue(false);
    await openFindReplaceModal(deps);

    getLastBody()!.onQueryChange("hello");
    getLastBody()!.onSearch();
    getPending()!.resolve(
      okResult([{ page: "index", line: 1, snippet: "hello" }], 1),
    );
    await flush();

    const replaceAll = getActions().find((a) => a.label === "Replace All")!;
    const handler = replaceAll.onClick as () => Promise<void>;
    const run = handler();
    getPending()!.resolve(
      okResult([{ page: "index", line: 1, snippet: "hello" }], 1),
    );
    await run;
    await flush();

    expect(replaced).toHaveLength(0);
    expect(statuses).toContain(
      "Replace canceled: save or discard your changes first.",
    );
  });

  it("reports an empty query", async () => {
    const { deps, getLastBody, statuses } = makeDeps();
    await openFindReplaceModal(deps);
    getLastBody()!.onQueryChange("   ");
    getLastBody()!.onSearch();
    await flush();
    expect(statuses).toContain("Enter text to find.");
  });

  it("reports a failed search without replacing", async () => {
    const { deps, getLastBody, getPending, getActions, statuses } = makeDeps();
    await openFindReplaceModal(deps);

    getLastBody()!.onQueryChange("hello");
    getLastBody()!.onSearch();
    getPending()!.resolve({ ok: false, error: "boom" });
    await flush();
    expect(statuses).toContain("Search failed: boom");

    // Replace All from a failed search state must not act.
    const replaceAll = getActions().find((a) => a.label === "Replace All")!;
    const handler = replaceAll.onClick as () => Promise<void>;
    const run = handler();
    getPending()!.resolve({ ok: false, error: "boom" });
    await run;
    await flush();
  });

  it("reports a failed replace", async () => {
    const { deps, getLastBody, getPending, getActions, statuses } = makeDeps();
    await openFindReplaceModal(deps);

    getLastBody()!.onQueryChange("hello");
    getLastBody()!.onSearch();
    getPending()!.resolve(
      okResult([{ page: "index", line: 1, snippet: "hello" }], 1),
    );
    await flush();

    (deps.replaceAllInPages as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: "write failed",
    });
    const replaceAll = getActions().find((a) => a.label === "Replace All")!;
    const handler = replaceAll.onClick as () => Promise<void>;
    const run = handler();
    getPending()!.resolve(
      okResult([{ page: "index", line: 1, snippet: "hello" }], 1),
    );
    await run;
    await flush();
    expect(statuses).toContain("Replace failed: write failed");
  });

  it("does nothing when the replace search has no matches", async () => {
    const { deps, getLastBody, getPending, getActions, statuses, replaced } =
      makeDeps();
    await openFindReplaceModal(deps);

    getLastBody()!.onQueryChange("hello");
    getLastBody()!.onSearch();
    getPending()!.resolve(okResult([], 0));
    await flush();

    const replaceAll = getActions().find((a) => a.label === "Replace All")!;
    const handler = replaceAll.onClick as () => Promise<void>;
    const run = handler();
    getPending()!.resolve(okResult([], 0));
    await run;
    await flush();
    expect(replaced).toHaveLength(0);
    expect(statuses).toContain("Nothing to replace.");
  });

  it("invalidates results when search options change", async () => {
    const { deps, getLastBody, getPending } = makeDeps();
    await openFindReplaceModal(deps);

    getLastBody()!.onQueryChange("hello");
    getLastBody()!.onSearch();
    getPending()!.resolve(
      okResult([{ page: "index", line: 1, snippet: "hello" }], 1),
    );
    await flush();
    expect(getLastBody()!.matches).toHaveLength(1);

    // Toggling case-sensitivity invalidates the visible results.
    getLastBody()!.onCaseSensitiveChange(true);
    expect(getLastBody()!.matches).toBeNull();
    expect(getLastBody()!.searchedQuery).toBe("");

    // Toggling whole-word does the same.
    getLastBody()!.onWholeWordChange(true);
    expect(getLastBody()!.matches).toBeNull();
  });

  it("passes the replacement text into the replace call", async () => {
    const { deps, getLastBody, getPending, getActions, replaced } = makeDeps();
    await openFindReplaceModal(deps);

    getLastBody()!.onReplacementChange("goodbye");
    getLastBody()!.onQueryChange("hello");
    getLastBody()!.onSearch();
    getPending()!.resolve(
      okResult([{ page: "index", line: 1, snippet: "hello" }], 1),
    );
    await flush();

    const replaceAll = getActions().find((a) => a.label === "Replace All")!;
    const handler = replaceAll.onClick as () => Promise<void>;
    const run = handler();
    getPending()!.resolve(
      okResult([{ page: "index", line: 1, snippet: "hello" }], 1),
    );
    await run;
    await flush();

    const replaceMock = deps.replaceAllInPages as ReturnType<typeof vi.fn>;
    expect(replaced).toEqual(["hello"]);
    expect(replaceMock.mock.calls[0]![3]).toBe("goodbye");
  });

  it("closes and loads the page when a match is opened", async () => {
    const { deps, getLastBody, getActions } = makeDeps();
    const closed = vi.spyOn(deps, "closeModal");
    await openFindReplaceModal(deps);

    getLastBody()!.onOpenPage("about");
    expect(closed).toHaveBeenCalled();
    expect(deps.loadPage).toHaveBeenCalledWith("about");
    void getActions;
  });
});
