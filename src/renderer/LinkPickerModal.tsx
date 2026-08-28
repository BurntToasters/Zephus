import { createSignal } from "solid-js";
import { render } from "solid-js/web";

export type LinkPickerKind = "page" | "url" | "email" | "phone" | "anchor";

export interface LinkPickerPageOption {
  value: string;
  label: string;
}

export interface LinkPickerModalState {
  kind: LinkPickerKind;
  pageOptions: LinkPickerPageOption[];
  pageValue: string;
  /** The current link is a route not present in pageOptions — never silently replace it with the first listed page. */
  pageValueMissing?: boolean;
  rawValue: string;
  onKindChange: (value: LinkPickerKind) => void;
  onPageValueChange: (value: string) => void;
  onRawValueChange: (value: string) => void;
}

function fieldLabel(kind: LinkPickerKind): string {
  switch (kind) {
    case "page":
      return "Target page";
    case "url":
      return "URL";
    case "email":
      return "Email address";
    case "phone":
      return "Phone number";
    case "anchor":
      return "Anchor id";
  }
}

function placeholder(kind: LinkPickerKind): string {
  switch (kind) {
    case "url":
      return "https://example.com";
    case "email":
      return "name@example.com";
    case "phone":
      return "+1 555 123 4567";
    case "anchor":
      return "section-id";
    case "page":
      return "";
  }
}

export function renderLinkPickerModal(
  container: HTMLElement,
  state: LinkPickerModalState,
): () => void {
  container.innerHTML = "";
  return render(() => {
    // Local signals keep focus while typing: re-rendering the whole body on
    // every keystroke would destroy the focused input and drop input.
    const [raw, setRaw] = createSignal(state.rawValue);
    const [pageValue, setPageValue] = createSignal(state.pageValue);
    return (
      <div class="meta-form">
        <label class="meta-field">
          <span>Link type</span>
          <select
            value={state.kind}
            onChange={(event) =>
              state.onKindChange(event.currentTarget.value as LinkPickerKind)
            }
          >
            <option value="page">Page in this site</option>
            <option value="url">External URL</option>
            <option value="email">Email address</option>
            <option value="phone">Phone number</option>
            <option value="anchor">Anchor on this page</option>
          </select>
        </label>

        {state.kind === "page" ? (
          <label class="meta-field">
            <span>{fieldLabel(state.kind)}</span>
            {state.pageValueMissing ? (
              <p class="muted" style="margin: 4px 0 8px">
                The current link target is not in the page list (it may be a
                hand-authored or detached page). Choose a listed page below, or
                switch to URL to keep the exact address.
              </p>
            ) : null}
            <select
              value={pageValue()}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setPageValue(value);
                state.onPageValueChange(value);
              }}
            >
              {state.pageValueMissing ? (
                <option value="" disabled>
                  Choose a page…
                </option>
              ) : null}
              {state.pageOptions.map((option) => (
                <option value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        ) : (
          <label class="meta-field">
            <span>{fieldLabel(state.kind)}</span>
            <input
              class="text"
              value={raw()}
              placeholder={placeholder(state.kind)}
              onInput={(event) => {
                const value = event.currentTarget.value;
                setRaw(value);
                state.onRawValueChange(value);
              }}
            />
          </label>
        )}
      </div>
    );
  }, container);
}
