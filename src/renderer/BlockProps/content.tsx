/**
 * Per-block-type content editors (the ContentGroup switch). Split from
 * BlockProperties.tsx so each block type's editor is a small focused case.
 */

import {
  ButtonVariantField,
  Group,
  HeadingLevelField,
  LengthField,
  LinkField,
  SelectField,
  TextareaField,
  TextField,
  ToggleField,
  type BlockPropertiesState,
} from "./shared";
import { GalleryContentGroup, ImageContentGroup } from "./imageGallery";

export function ContentGroup(props: { state: BlockPropertiesState }) {
  const state = props.state;
  const value = (key: string) => state.props[key] ?? "";

  switch (state.blockType) {
    case "html":
      return (
        <Group title="Content">
          <TextareaField
            label="Markup"
            value={state.raw ?? ""}
            rows={12}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onRawChange?.(next)}
          />
          <p class="muted">
            Edits update this HTML block in visual mode. Use Code mode for
            full-page Astro source.
          </p>
        </Group>
      );
    case "heading":
      return (
        <Group title="Content">
          <TextField
            label="Text"
            value={value("text")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("text", next)}
          />
          <HeadingLevelField
            value={value("level") || "2"}
            maxHeadingLevel={state.maxHeadingLevel}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("level", next)}
          />
        </Group>
      );
    case "text":
    case "section":
      return (
        <Group title="Content">
          <TextareaField
            label="Text"
            value={value("text")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("text", next)}
          />
        </Group>
      );
    case "quote":
      return (
        <Group title="Content">
          <TextareaField
            label="Text"
            value={value("text")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("text", next)}
          />
          <TextField
            label="Citation"
            value={value("cite")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("cite", next)}
          />
        </Group>
      );
    case "button":
      return (
        <Group title="Content">
          <TextField
            label="Label"
            value={value("text")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("text", next)}
          />
          <LinkField
            label="Link"
            value={value("href")}
            onPick={state.onPickLink}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("href", next)}
          />
          <ButtonVariantField
            cls={value("cls")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("cls", next)}
          />
        </Group>
      );
    case "columns": {
      const total = Number(state.style?.columns ?? value("count") ?? 2);
      return (
        <Group title="Content">
          <SelectField
            label="Columns"
            value={String(total)}
            options={["2", "3", "4"].map((option) => ({
              value: option,
              label: option,
            }))}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => {
              state.onPropChange("count", next);
              state.onStyleChange("columns", next, true);
            }}
          />
          {Array.from({ length: total }, (_, index) => (
            <TextareaField
              label={`Column ${index + 1}`}
              value={value(`col${index + 1}`)}
              rows={3}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onPropChange(`col${index + 1}`, next)}
            />
          ))}
        </Group>
      );
    }
    case "card":
      return (
        <Group title="Content">
          <TextField
            label="Title"
            value={value("title")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("title", next)}
          />
          <TextareaField
            label="Body"
            value={value("text")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("text", next)}
          />
        </Group>
      );
    case "image":
      return (
        <ImageContentGroup
          state={state}
          src={value("src")}
          alt={value("alt")}
        />
      );
    case "gallery":
      return <GalleryContentGroup state={state} />;
    case "list":
      return (
        <Group title="Content">
          <TextareaField
            label="Items"
            value={value("items")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("items", next)}
          />
          <ToggleField
            label="Ordered list"
            checked={value("ordered") === "true"}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) =>
              state.onPropChange("ordered", next ? "true" : "false")
            }
          />
        </Group>
      );
    case "embed":
      return (
        <Group title="Content">
          <TextField
            label="Embed URL"
            value={value("src")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("src", next)}
          />
          <TextField
            label="Title"
            value={value("title")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("title", next)}
          />
        </Group>
      );
    case "video":
      return (
        <Group title="Content">
          <TextField
            label="Video URL"
            value={value("src")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("src", next)}
          />
          <TextField
            label="Title"
            value={value("title")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("title", next)}
          />
          <p class="muted">
            Use an .mp4 or .webm URL (https, or a project file under
            public/assets). Project files play in the preview browser.
          </p>
        </Group>
      );
    case "spacer":
      return (
        <Group title="Content">
          {/* The Layout panel's "Height" (style.height) takes precedence over
              this prop in the renderer; when set, this field is inert. Use
              LengthField so bare numbers get px and invalid CSS never ships. */}
          <LengthField
            label={
              state.style?.height
                ? "Height (overridden by Layout Height)"
                : "Height"
            }
            value={value("height")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("height", next)}
          />
        </Group>
      );
    case "divider":
      return (
        <Group title="Content">
          <p class="muted">
            Divider blocks render a horizontal rule. Use the layout and style
            controls below to adjust spacing and appearance.
          </p>
        </Group>
      );
    case "feature":
      return (
        <Group title="Content">
          <TextField
            label="Icon (emoji or text)"
            value={value("icon")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("icon", next)}
          />
          <TextField
            label="Title"
            value={value("title")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("title", next)}
          />
          <TextareaField
            label="Description"
            value={value("text")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("text", next)}
          />
        </Group>
      );
    case "testimonial":
      return (
        <Group title="Content">
          <TextareaField
            label="Quote"
            value={value("quote")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("quote", next)}
          />
          <TextField
            label="Author"
            value={value("author")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("author", next)}
          />
          <TextField
            label="Role / company"
            value={value("role")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("role", next)}
          />
        </Group>
      );
    case "accordion":
      return (
        <Group title="Content">
          <TextareaField
            label="Items (one per line: Question :: Answer)"
            value={value("items")}
            rows={6}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("items", next)}
          />
        </Group>
      );
    case "stats":
      return (
        <Group title="Content">
          <TextareaField
            label="Stats (one per line: Number :: Label)"
            value={value("items")}
            rows={5}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("items", next)}
          />
        </Group>
      );
    case "pricing":
      return (
        <Group title="Content">
          <TextField
            label="Plan name"
            value={value("plan")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("plan", next)}
          />
          <TextField
            label="Price"
            value={value("price")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("price", next)}
          />
          <TextField
            label="Period (e.g. /mo)"
            value={value("period")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("period", next)}
          />
          <TextareaField
            label="Features (one per line)"
            value={value("features")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("features", next)}
          />
          <TextField
            label="Button label"
            value={value("ctaText")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("ctaText", next)}
          />
          <LinkField
            label="Button link"
            value={value("ctaHref")}
            onPick={state.onPickLink}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("ctaHref", next)}
          />
        </Group>
      );
    case "cta":
      return (
        <Group title="Content">
          <TextField
            label="Heading"
            value={value("heading")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("heading", next)}
          />
          <TextareaField
            label="Text"
            value={value("text")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("text", next)}
          />
          <TextField
            label="Button label"
            value={value("buttonText")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("buttonText", next)}
          />
          <LinkField
            label="Button link"
            value={value("buttonHref")}
            onPick={state.onPickLink}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("buttonHref", next)}
          />
        </Group>
      );
    case "postlist": {
      const toggle = (
        label: string,
        prop: string,
        defaultOn: boolean,
      ): ReturnType<typeof SelectField> => (
        <SelectField
          label={label}
          value={
            (value(prop) || (defaultOn ? "true" : "false")) === "true"
              ? "true"
              : "false"
          }
          options={[
            { value: "true", label: "Show" },
            { value: "false", label: "Hide" },
          ]}
          onFocus={state.onFocus}
          onBlur={state.onBlur}
          onChange={(next) => state.onPropChange(prop, next, true)}
        />
      );
      return (
        <Group title="Content">
          <TextField
            label="Folder (route prefix)"
            // Show the ACTUAL stored value: an empty folder means "all
            // posts", but falling back to "/posts" here made a cleared field
            // display as a /posts filter on reload — the panel claimed a
            // state the build did not honor.
            value={value("folder")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("folder", next)}
          />
          <TextField
            label="Maximum posts (0 for all)"
            // Same lie: cleared limit means 0 = all, but the fallback "5"
            // displayed a filter that was not applied.
            value={value("limit")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("limit", next)}
          />
          {toggle("Publish date", "showDate", true)}
          {toggle("Author", "showAuthor", false)}
          {toggle("Description", "showExcerpt", true)}
          {toggle("Share image", "showImage", false)}
          <TextField
            label="Text when empty"
            value={value("emptyText")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("emptyText", next)}
          />
        </Group>
      );
    }
    default:
      return null;
  }
}
