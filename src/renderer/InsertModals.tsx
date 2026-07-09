import { For } from "solid-js";
import { render } from "solid-js/web";

export interface InsertModalOption {
  label: string;
  primary?: boolean;
  onSelect: () => void;
}

export function renderInsertModal(
  container: HTMLElement,
  options: InsertModalOption[],
): void {
  container.innerHTML = "";
  render(
    () => (
      <div class="insert-grid">
        <For each={options}>
          {(option) => (
            <button
              class={option.primary ? "btn primary" : "btn"}
              onClick={option.onSelect}
            >
              {option.label}
            </button>
          )}
        </For>
      </div>
    ),
    container,
  );
}
