/** The block properties panel: header, per-type content editor, layout/style/ responsive sections, and the action row. */

import { render } from "solid-js/web";
import type { BlockPropertiesState } from "./BlockProps/shared";
import { ContentGroup } from "./BlockProps/content";
import {
  ColorField,
  Group,
  LengthField,
  SelectField,
  TextField,
  ToggleField,
} from "./SectionProperties";

export function renderBlockProperties(
  container: HTMLElement,
  state: BlockPropertiesState,
): () => void {
  container.innerHTML = "";
  return render(
    () => (
      <>
        <div class="prop-header">
          <strong>{state.title}</strong>
          <span class="muted">{state.subtitle}</span>
        </div>
        {state.locked ? (
          <p class="muted">This block is locked. Unlock it to edit.</p>
        ) : null}

        <fieldset disabled={state.locked} class="prop-fieldset">
          <ContentGroup state={state} />

          <Group title="Layout">
            <SelectField
              label="Alignment"
              value={(state.style?.align as string) ?? "left"}
              options={["left", "center", "right"].map((value) => ({
                value,
                label: value,
              }))}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onStyleChange("align", next)}
            />
            <LengthField
              label="Width"
              value={state.style?.width ?? ""}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onStyleChange("width", next)}
            />
            <LengthField
              label="Height"
              value={state.style?.height ?? ""}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onStyleChange("height", next)}
            />
            <LengthField
              label="Max width"
              value={state.style?.maxWidth ?? ""}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onStyleChange("maxWidth", next)}
            />
            <LengthField
              label="Gap"
              value={state.style?.gap ?? ""}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onStyleChange("gap", next)}
            />
            {state.blockType === "gallery" ? (
              <TextField
                label="Columns"
                // Sanitized on commit: gallery columns map to
                // `repeat(N, ...)` — 0/negative/huge/garbage values silently
                // produce invalid CSS or a broken grid. Clamp to 1..6.
                value={state.style?.columns ?? ""}
                onFocus={state.onFocus}
                onBlur={state.onBlur}
                onChange={(next) => {
                  const parsed = Math.floor(Number(next));
                  const clamped = Number.isFinite(parsed)
                    ? String(Math.min(6, Math.max(1, parsed)))
                    : "";
                  state.onStyleChange("columns", clamped);
                }}
              />
            ) : null}
            <ToggleField
              label="Stack on mobile"
              checked={state.style?.stackOnMobile ?? false}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onStyleChange("stackOnMobile", next)}
            />
            <ToggleField
              label="Hide on desktop"
              checked={(state.style?.hideOn ?? []).includes("desktop")}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => {
                const current = state.style?.hideOn ?? [];
                state.onStyleChange(
                  "hideOn",
                  next
                    ? [...new Set([...current, "desktop"])]
                    : current.filter((v) => v !== "desktop"),
                );
              }}
            />
            <ToggleField
              label="Hide on tablet"
              checked={(state.style?.hideOn ?? []).includes("tablet")}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => {
                const current = state.style?.hideOn ?? [];
                state.onStyleChange(
                  "hideOn",
                  next
                    ? [...new Set([...current, "tablet"])]
                    : current.filter((v) => v !== "tablet"),
                );
              }}
            />
            <ToggleField
              label="Hide on mobile"
              checked={(state.style?.hideOn ?? []).includes("mobile")}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => {
                const current = state.style?.hideOn ?? [];
                state.onStyleChange(
                  "hideOn",
                  next
                    ? [...new Set([...current, "mobile"])]
                    : current.filter((v) => v !== "mobile"),
                );
              }}
            />
            <p class="meta-hint">
              Hidden content stays editable on the canvas (dashed outline) and
              disappears from the published site at that width.
            </p>
          </Group>

          <Group title="Style">
            <ColorField
              label="Background"
              value={state.style?.background ?? ""}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onStyleChange("background", next)}
            />
            <ColorField
              label="Text color"
              value={state.style?.color ?? ""}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onStyleChange("color", next)}
            />
            <LengthField
              label="Padding"
              value={state.style?.padding ?? ""}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onStyleChange("padding", next)}
            />
            <LengthField
              label="Margin"
              value={state.style?.margin ?? ""}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onStyleChange("margin", next)}
            />
            <LengthField
              label="Radius"
              value={state.style?.radius ?? ""}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onStyleChange("radius", next)}
            />
            <SelectField
              label="Shadow"
              value={(state.style?.shadow as string) ?? "none"}
              options={["none", "sm", "md", "lg"].map((value) => ({
                value,
                label: value,
              }))}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onStyleChange("shadow", next)}
            />
          </Group>

          <Group title="Advanced">
            <TextField
              label="CSS class (optional)"
              value={state.props["cls"] ?? ""}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onPropChange("cls", next)}
            />
            {state.currentViewport !== "desktop" ? (
              <>
                <div class="responsive-note">
                  <strong>{state.currentViewport}</strong> override
                </div>
                <LengthField
                  label="Viewport width"
                  value={state.responsive.width ?? ""}
                  onFocus={state.onFocus}
                  onBlur={state.onBlur}
                  onChange={(next) =>
                    state.onResponsiveStyleChange("width", next)
                  }
                />
                <LengthField
                  label="Viewport height"
                  value={state.responsive.height ?? ""}
                  onFocus={state.onFocus}
                  onBlur={state.onBlur}
                  onChange={(next) =>
                    state.onResponsiveStyleChange("height", next)
                  }
                />
                <LengthField
                  label="Viewport padding"
                  value={state.responsive.padding ?? ""}
                  onFocus={state.onFocus}
                  onBlur={state.onBlur}
                  onChange={(next) =>
                    state.onResponsiveStyleChange("padding", next)
                  }
                />
                <LengthField
                  label="Viewport margin"
                  value={state.responsive.margin ?? ""}
                  onFocus={state.onFocus}
                  onBlur={state.onBlur}
                  onChange={(next) =>
                    state.onResponsiveStyleChange("margin", next)
                  }
                />
              </>
            ) : null}
            {state.onSaveReusable ? (
              <button class="btn" onClick={state.onSaveReusable}>
                Save as Reusable Section
              </button>
            ) : null}
          </Group>
        </fieldset>

        <div class="prop-actions">
          <button class="btn" onClick={state.onDuplicate}>
            Duplicate
          </button>
          <button class="btn" disabled={state.locked} onClick={state.onMoveUp}>
            Move Up
          </button>
          <button
            class="btn"
            disabled={state.locked}
            onClick={state.onMoveDown}
          >
            Move Down
          </button>
          <button class="btn" disabled={state.locked} onClick={state.onWrap}>
            Wrap
          </button>
          <button class="btn" onClick={state.onToggleLock}>
            {state.locked ? "Unlock" : "Lock"}
          </button>
          <button
            class="btn danger"
            disabled={state.locked}
            onClick={state.onDelete}
          >
            Delete
          </button>
        </div>
      </>
    ),
    container,
  );
}
