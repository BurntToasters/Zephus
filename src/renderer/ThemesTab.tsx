import {
  For,
  Match,
  Switch,
  createEffect,
  createSignal,
  onCleanup,
} from "solid-js";
import { render } from "solid-js/web";

interface ThemeHeaderDetails {
  gradient: string;
  icon: string;
}

export interface ThemeCardEntry {
  id: string;
  name: string;
  description: string;
  previewUrl: string | null;
  selected: boolean;
  header: ThemeHeaderDetails;
}

export interface ThemesTabState {
  mode: "placeholder" | "loading" | "ready" | "error";
  error?: string;
  themes: ThemeCardEntry[];
}

export interface ThemesTabHandlers {
  onLoadPreviews: () => void;
  onSelect: (themeId: string) => void;
  onPreview: (themeId: string) => void;
  onCreateFromTheme: (themeId: string) => void;
}

const [state, setState] = createSignal<ThemesTabState>({
  mode: "placeholder",
  themes: [],
});
let handlers: ThemesTabHandlers | null = null;

function runIconRefresh() {
  setTimeout(() => {
    if (typeof window.refreshIcons === "function") {
      window.refreshIcons();
    }
  }, 0);
}

function ThemeCard(props: { theme: ThemeCardEntry }) {
  let headerRef: HTMLDivElement | undefined;
  let frameRef: HTMLIFrameElement | undefined;

  createEffect(() => {
    runIconRefresh();
    const header = headerRef;
    const frame = frameRef;
    if (!header || !frame) return;
    const applyScale = () => {
      frame.style.transform = `scale(${header.offsetWidth / 1280})`;
    };
    applyScale();
    const observer = new ResizeObserver(applyScale);
    observer.observe(header);
    onCleanup(() => observer.disconnect());
  });

  return (
    <article
      classList={{ "theme-card": true, selected: props.theme.selected }}
      data-theme-id={props.theme.id}
      tabindex={0}
      role="button"
      aria-label={`Select ${props.theme.name} theme`}
      aria-pressed={props.theme.selected ? "true" : "false"}
      onClick={() => handlers?.onSelect(props.theme.id)}
      onDblClick={() => handlers?.onCreateFromTheme(props.theme.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handlers?.onSelect(props.theme.id);
        }
      }}
    >
      <div
        ref={(element) => {
          headerRef = element;
        }}
        classList={{
          "theme-card-icon-header": true,
          "has-preview": !!props.theme.previewUrl,
        }}
        style={
          props.theme.previewUrl
            ? undefined
            : { background: props.theme.header.gradient }
        }
      >
        {props.theme.previewUrl ? (
          <iframe
            ref={(element) => {
              frameRef = element;
            }}
            class="theme-card-preview-frame"
            sandbox="allow-scripts allow-same-origin"
            title={`${props.theme.name} preview`}
            aria-hidden="true"
            tabindex="-1"
            src={props.theme.previewUrl}
          />
        ) : (
          <div class="theme-card-icon-pill">
            <i data-lucide={props.theme.header.icon}></i>
          </div>
        )}
      </div>

      <div class="theme-card-body">
        <span class="t-name">{props.theme.name}</span>
        <span class="t-desc">{props.theme.description}</span>
      </div>

      <div class="theme-card-actions">
        <button
          class="mini-btn"
          onClick={(event) => {
            event.stopPropagation();
            handlers?.onPreview(props.theme.id);
          }}
        >
          Preview
        </button>
        <button
          class="mini-btn theme-select-btn"
          onClick={(event) => {
            event.stopPropagation();
            handlers?.onSelect(props.theme.id);
          }}
        >
          {props.theme.selected ? "Selected" : "Select"}
        </button>
      </div>
    </article>
  );
}

export function ThemesTabPanel() {
  createEffect(() => {
    state();
    runIconRefresh();
  });

  return (
    <Switch>
      <Match when={state().mode === "placeholder"}>
        <article class="theme-card">
          <div class="theme-card-preview">
            <div class="theme-card-preview-empty">
              Theme previews load on demand
            </div>
          </div>
          <div class="theme-card-body">
            <span class="t-name">Bundled starter themes</span>
            <span class="t-desc">
              Open Get Started to lazy-load live previews for each bundled
              Zephus theme.
            </span>
          </div>
          <div class="theme-card-actions">
            <button
              class="btn primary"
              onClick={() => handlers?.onLoadPreviews()}
            >
              Load Theme Previews
            </button>
          </div>
        </article>
      </Match>
      <Match when={state().mode === "loading"}>
        <p class="muted">Loading theme previews…</p>
      </Match>
      <Match when={state().mode === "error"}>
        <p class="muted">Could not load themes: {state().error}</p>
      </Match>
      <Match when={state().mode === "ready"}>
        <For each={state().themes}>
          {(theme) => <ThemeCard theme={theme} />}
        </For>
      </Match>
    </Switch>
  );
}

export function updateThemesTab(nextState: ThemesTabState): void {
  setState(nextState);
}

export function registerThemesTabHandlers(
  nextHandlers: ThemesTabHandlers,
): void {
  handlers = nextHandlers;
}

export function mountThemesTab(container: HTMLElement): void {
  container.innerHTML = "";
  render(() => <ThemesTabPanel />, container);
}
