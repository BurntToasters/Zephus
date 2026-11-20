/** Stops canvas links from navigating the editor while a page is being edited. */

function eventTargetElement(event: Event): Element | null {
  const target = event.target;
  return target instanceof Element ? target : null;
}

function isCanvasLink(event: Event): boolean {
  // `href` in the XLink namespace does not match `a[href]`, and Chrome still
  // navigates an SVG `<a xlink:href>`. `*|href` matches every namespace.
  return !!eventTargetElement(event)?.closest("a[*|href], area[*|href]");
}

/** Primary click, keyboard activation, and middle-click all use these events. */
export function installCanvasLinkGuard(root: HTMLElement): void {
  root.querySelectorAll<HTMLIFrameElement>("iframe").forEach((frame) => {
    frame.tabIndex = -1;
  });
  // These stay clickable so a label can be double-clicked and edited. Activating
  // one does not navigate, so it must not sit in the editor tab order.
  root.querySelectorAll<HTMLElement>("a, area").forEach((link) => {
    link.tabIndex = -1;
  });
  if (root.dataset["canvasLinksInert"] === "true") return;
  root.dataset["canvasLinksInert"] = "true";
  const stopLink = (event: Event) => {
    if (isCanvasLink(event)) event.preventDefault();
  };
  root.addEventListener("click", stopLink, true);
  root.addEventListener("auxclick", stopLink, true);
  root.addEventListener(
    "mousedown",
    (event) => {
      if (!("button" in event) || event.button !== 1) return;
      stopLink(event);
    },
    true,
  );
}
