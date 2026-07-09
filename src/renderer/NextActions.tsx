import { render } from "solid-js/web";
import { createSignal, For, Show } from "solid-js";

export interface NextActionAction {
  label: string;
  onClick: () => void;
}

export interface NextActionCardData {
  title: string;
  body: string;
  actions: NextActionAction[];
}

const [actions, setActions] = createSignal<NextActionCardData[]>([]);
const [hasProject, setHasProject] = createSignal(false);

export function NextActionsList() {
  return (
    <div class="next-actions-list">
      <Show
        when={hasProject()}
        fallback={
          <p class="muted">Guided actions will appear here while you edit.</p>
        }
      >
        <Show
          when={actions().length > 0}
          fallback={
            <p class="muted">
              Use preview to verify your page, then publish when the content and
              navigation look right.
            </p>
          }
        >
          <For each={actions()}>
            {(card) => (
              <section class="next-action-card">
                <div class="next-action-title">
                  <strong>{card.title}</strong>
                </div>
                <p>{card.body}</p>
                <div class="next-action-actions">
                  <For each={card.actions}>
                    {(action) => (
                      <button class="mini-btn" onClick={action.onClick}>
                        {action.label}
                      </button>
                    )}
                  </For>
                </div>
              </section>
            )}
          </For>
        </Show>
      </Show>
    </div>
  );
}

export function updateNextActions(
  hasProj: boolean,
  items: NextActionCardData[],
): void {
  setHasProject(hasProj);
  setActions(items);
}

export function mountNextActions(container: HTMLElement): void {
  container.innerHTML = "";
  render(() => <NextActionsList />, container);
}
