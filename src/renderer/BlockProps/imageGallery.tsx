/**
 * Image + gallery content editors. Split from BlockProperties.tsx.
 */

import { createSignal, For } from "solid-js";
import {
  AssetPreviewImage,
  galleryItems,
  Group,
  IMAGE_ASPECT_OPTIONS,
  parseObjectPosition,
  SelectField,
  TextField,
  type BlockPropertiesState,
} from "./shared";

export function ImageContentGroup(props: {
  state: BlockPropertiesState;
  src: string;
  alt: string;
}) {
  const [position, setPosition] = createSignal(
    parseObjectPosition(props.state.style?.objectPosition ?? "50% 50%"),
  );
  let focalBox: HTMLDivElement | undefined;
  let dragging = false;

  const updatePosition = (event: PointerEvent, commit: boolean) => {
    if (!focalBox) return;
    const rect = focalBox.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = Math.round(
      Math.min(
        100,
        Math.max(0, ((event.clientX - rect.left) / rect.width) * 100),
      ),
    );
    const y = Math.round(
      Math.min(
        100,
        Math.max(0, ((event.clientY - rect.top) / rect.height) * 100),
      ),
    );
    setPosition({ x, y });
    if (commit) {
      props.state.onStyleChange("objectPosition", `${x}% ${y}%`);
    }
  };

  return (
    <Group title="Content">
      <div class="prop-actions">
        <button
          type="button"
          class="btn"
          onClick={() => props.state.onPickImage?.()}
        >
          {props.src ? "Replace Image" : "Choose Image"}
        </button>
        <button
          type="button"
          class="btn ghost"
          onClick={() => props.state.onClearImage?.()}
        >
          Remove
        </button>
      </div>
      <TextField
        label="Alt text"
        value={props.alt}
        onFocus={props.state.onFocus}
        onBlur={props.state.onBlur}
        onChange={(next) => props.state.onPropChange("alt", next)}
      />
      {props.src ? (
        <>
          <SelectField
            label="Shape"
            value={(props.state.style?.aspectRatio as string) ?? ""}
            options={IMAGE_ASPECT_OPTIONS}
            onFocus={props.state.onFocus}
            onBlur={props.state.onBlur}
            onChange={(next) => props.state.onStyleChange("aspectRatio", next)}
          />
          <SelectField
            label="Fit"
            value={(props.state.style?.objectFit as string) ?? "cover"}
            options={[
              { value: "cover", label: "Fill frame (crop)" },
              { value: "contain", label: "Fit inside" },
              { value: "fill", label: "Stretch" },
            ]}
            onFocus={props.state.onFocus}
            onBlur={props.state.onBlur}
            onChange={(next) => props.state.onStyleChange("objectFit", next)}
          />
          <div class="meta-field">
            <span>Focus point (drag)</span>
            <div
              ref={(element) => {
                focalBox = element;
              }}
              class="focal-box"
              onPointerDown={(event) => {
                event.preventDefault();
                dragging = true;
                props.state.onFocus();
                event.currentTarget.setPointerCapture(event.pointerId);
                updatePosition(event, false);
              }}
              onPointerMove={(event) => {
                if (dragging) updatePosition(event, false);
              }}
              onPointerUp={(event) => {
                if (!dragging) return;
                dragging = false;
                updatePosition(event, true);
                props.state.onBlur();
              }}
              onPointerCancel={() => {
                if (!dragging) return;
                dragging = false;
                const current = position();
                props.state.onStyleChange(
                  "objectPosition",
                  `${current.x}% ${current.y}%`,
                );
                props.state.onBlur();
              }}
            >
              <AssetPreviewImage
                class="focal-img"
                src={props.src}
                alt=""
                resolveAssetPreviewSrc={props.state.resolveAssetPreviewSrc}
              />
              <div
                class="focal-dot"
                style={{
                  left: `${position().x}%`,
                  top: `${position().y}%`,
                }}
              />
            </div>
          </div>
        </>
      ) : null}
    </Group>
  );
}

export function GalleryContentGroup(props: { state: BlockPropertiesState }) {
  const items = () => galleryItems(props.state.props);

  return (
    <Group title="Content">
      <div class="prop-actions">
        <button
          type="button"
          class="btn"
          onClick={() => props.state.onAddGalleryImage?.()}
        >
          Add Image from Assets
        </button>
      </div>
      {items().length === 0 ? (
        <p class="muted">No images yet. Add one from your assets.</p>
      ) : (
        <div class="gallery-manager">
          <For each={items()}>
            {(item, index) => (
              <div class="gallery-item">
                <AssetPreviewImage
                  class="gallery-thumb"
                  src={item.src}
                  alt=""
                  resolveAssetPreviewSrc={props.state.resolveAssetPreviewSrc}
                />
                <div class="gallery-item-main">
                  <TextField
                    label={`Alt text ${index() + 1}`}
                    value={item.alt}
                    onFocus={props.state.onFocus}
                    onBlur={props.state.onBlur}
                    onChange={(next) =>
                      props.state.onPropChange(item.altKey, next)
                    }
                  />
                </div>
                <div class="gallery-item-actions">
                  <button
                    type="button"
                    class="btn ghost"
                    title="Move up"
                    aria-label={`Move image ${index() + 1} up`}
                    disabled={index() === 0}
                    onClick={() =>
                      props.state.onReorderGalleryImage?.(index(), index() - 1)
                    }
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    class="btn ghost"
                    title="Move down"
                    aria-label={`Move image ${index() + 1} down`}
                    disabled={index() === items().length - 1}
                    onClick={() =>
                      props.state.onReorderGalleryImage?.(index(), index() + 1)
                    }
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    class="btn ghost"
                    title="Remove"
                    aria-label={`Remove image ${index() + 1}`}
                    onClick={() => props.state.onRemoveGalleryImage?.(index())}
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}
          </For>
        </div>
      )}
    </Group>
  );
}
