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
): void {
  container.innerHTML = "";
  render(
    () => (
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
            <select
              value={state.pageValue}
              onChange={(event) =>
                state.onPageValueChange(event.currentTarget.value)
              }
            >
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
              value={state.rawValue}
              placeholder={placeholder(state.kind)}
              onInput={(event) =>
                state.onRawValueChange(event.currentTarget.value)
              }
            />
          </label>
        )}
      </div>
    ),
    container,
  );
}
