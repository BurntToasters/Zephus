# Content Block Reference

Zephus provides 20 different content block types to build your pages. Each block has specific properties you can edit in the inspector panel (right sidebar).

## Block Categories

### 🔤 Text & Typography

#### **Heading**
Large text for page titles and section headers.

| Property | Type | Example |
|----------|------|---------|
| `text` | Text | "My Page Title" |
| `level` | Dropdown (1–6) | 1 (largest) to 6 (smallest) |
| `cls` | CSS class | "text-gradient" |

**Use for:** Page titles, section headers, emphasis

---

#### **Text**
Paragraph of body text.

| Property | Type | Example |
|----------|------|---------|
| `text` | Text | "This is my paragraph..." |
| `cls` | CSS class | "text-large" |

**Use for:** Paragraphs, descriptions, body copy

---

#### **Quote**
Styled blockquote with optional attribution.

| Property | Type | Example |
|----------|------|---------|
| `text` | Text | "Innovation distinguishes leaders." |
| `cite` | Text | "Steve Jobs" |
| `cls` | CSS class | "" |

**Use for:** Testimonials, famous quotes, pull quotes

---

#### **List**
Ordered or unordered list of items.

| Property | Type | Example |
|----------|------|---------|
| `items` | Text (newline-separated) | "Item 1\nItem 2\nItem 3" |
| `ordered` | Toggle | false (bullet) or true (numbered) |
| `cls` | CSS class | "" |

**Use for:** Features, steps, ingredients, benefits

> 💡 **Tip**: Separate items with line breaks (`Enter` in the text field).

---

### 🖼️ Media & Gallery

#### **Image**
A single responsive image with alt text for accessibility.

| Property | Type | Example |
|----------|------|---------|
| `src` | Path or URL | "/images/my-photo.jpg" |
| `alt` | Text | "Team photo from 2024" |
| `cls` | CSS class | "rounded-lg" |

**Use for:** Photos, diagrams, illustrations

> 🔗 **Supported formats:** `.jpg`, `.png`, `.svg`, `.gif`, `.webp`

---

#### **Gallery**
Multiple images displayed in a grid.

| Property | Type | Example |
|----------|------|---------|
| `images` | Paths (newline-separated) | "/images/1.jpg\n/images/2.jpg" |
| `cls` | CSS class | "gallery-dark" |

**Use for:** Portfolio projects, photo albums, case studies

> 💡 **Tip**: One image path per line.

---

### 🎯 Interactive Elements

#### **Button**
Clickable button that links to a URL.

| Property | Type | Example |
|----------|------|---------|
| `text` | Text | "Get Started" |
| `href` | URL | "/contact" or "https://example.com" |
| `cls` | CSS class | "btn-large" |

**Use for:** Calls-to-action, navigation, links

**URL formats:**
- Relative: `/about`, `/blog/post-1`
- Absolute: `https://example.com`
- Email: `mailto:hello@example.com`
- Phone: `tel:+1234567890`

---

#### **Embed**
Embed external content (YouTube, Vimeo, maps, etc.).

| Property | Type | Example |
|----------|------|---------|
| `src` | Embed URL | "https://www.youtube.com/embed/..." |
| `title` | Text | "Product Demo" |
| `cls` | CSS class | "" |

**Use for:** Videos, maps, custom embeds

> 💡 **Getting embed URLs:**
> - **YouTube:** Right-click video → "Copy embed code" → extract `src` URL
> - **Vimeo:** Click "Share" → "Embed" → copy `src` URL
> - **Google Maps:** Right-click location → "Get link to this place" → convert to embed

---

#### **HTML**
Raw HTML/JSX for advanced customization (code mode only).

| Property | Type | Example |
|----------|------|---------|
| Content | HTML/JSX | `<div class="custom">...</div>` |

**Use for:** Custom styling, interactive widgets, one-off designs

> ⚠️ **Note**: HTML blocks can only be edited in Code mode. Switch to Code mode to edit the raw markup.

---

### 📦 Content Cards & Layouts

#### **Card**
A self-contained box with title and description.

| Property | Type | Example |
|----------|------|---------|
| `title` | Text | "Feature Name" |
| `text` | Text | "Description of the feature..." |
| `cls` | CSS class | "card-hover" |

**Use for:** Features, testimonials, team bios

---

#### **Columns**
Side-by-side layout for content (2 or 3 columns).

| Property | Type | Example |
|----------|------|---------|
| `col1` | Text | Left column content |
| `col2` | Text | Right column content |
| `count` | Dropdown (2 or 3) | 2 (50/50) or 3 (equal thirds) |
| `cls` | CSS class | "gap-large" |

**Use for:** Two-column layouts, feature comparisons, side-by-side text

---

### 🎨 Marketing & Showcase

#### **Feature**
Icon, title, and description for highlighting a feature.

| Property | Type | Example |
|----------|------|---------|
| `icon` | Icon name | "star", "zap", "heart" |
| `title` | Text | "Fast Performance" |
| `text` | Text | "Load 10x faster..." |
| `cls` | CSS class | "" |

**Use for:** Product features, service highlights, value propositions

> 💡 **Available icons:** See [Lucide icons](https://lucide.dev) for all icon names (e.g., `star`, `zap`, `heart`, `award`, `users`).

---

#### **Testimonial**
A styled customer quote with author name and role.

| Property | Type | Example |
|----------|------|---------|
| `quote` | Text | "This product changed my business!" |
| `author` | Text | "Jane Smith" |
| `role` | Text | "CEO, Acme Corp" |
| `cls` | CSS class | "" |

**Use for:** Customer testimonials, reviews, case study quotes

---

#### **Stats**
Display key numbers with labels (e.g., "10k+ customers").

| Property | Type | Example |
|----------|------|---------|
| `items` | Format: `VALUE :: LABEL` (newline-separated) | "10k+ :: Customers\n50+ :: Countries" |
| `cls` | CSS class | "" |

**Use for:** Metrics, achievements, results

> 💡 **Format:** Each line is `VALUE :: LABEL` separated by `::`.

---

#### **Pricing**
A pricing tier card with plan, price, features, and CTA button.

| Property | Type | Example |
|----------|------|---------|
| `plan` | Text | "Professional" |
| `price` | Text | "$29" |
| `period` | Text | "per month" |
| `features` | List (newline-separated) | "Feature 1\nFeature 2" |
| `ctaText` | Text | "Get Started" |
| `ctaHref` | URL | "/signup" |
| `cls` | CSS class | "" |

**Use for:** Pricing tables, service tiers, subscription options

---

#### **CTA** (Call-to-Action)
Large highlighted section with heading, text, and button.

| Property | Type | Example |
|----------|------|---------|
| `heading` | Text | "Ready to Get Started?" |
| `text` | Text | "Join thousands of happy customers..." |
| `buttonText` | Text | "Start Free Trial" |
| `buttonHref` | URL | "/signup" |
| `cls` | CSS class | "" |

**Use for:** Promotional sections, conversion moments, main CTAs

---

#### **Accordion**
Collapsible sections (questions and answers, FAQs, etc.).

| Property | Type | Example |
|----------|------|---------|
| `items` | Format: `QUESTION :: ANSWER` (newline-separated) | "How do I sign up? :: Click the button..." |
| `cls` | CSS class | "" |

**Use for:** FAQs, feature details, expandable content

> 💡 **Format:** Each line is `QUESTION :: ANSWER` separated by `::`.

---

### 🎬 Structural & Layout

#### **Section**
A container that groups blocks together. Sections have their own styling.

| Property | Type | Example |
|----------|------|---------|
| `label` | Text | "Hero" (for your reference) |
| `wrapper` | Dropdown ("none" or "box") | "box" |
| `cls` | CSS class | "hero-section" |

**Section-specific styling (in inspector):**
- Background color
- Text color  
- Padding (top, bottom, left, right)
- Margin
- Border radius
- Width & max-width
- Height
- Gap (spacing between nested blocks)

**Use for:** Visual grouping, background colors, responsive layouts

> 💡 **Tip**: Sections automatically stack on mobile. Use the `cls` property to add responsive classes for advanced layouts.

---

#### **Divider**
A horizontal line to separate content.

| Property | Type | Example |
|----------|------|---------|
| `cls` | CSS class | "" |

**Use for:** Section breaks, visual separation

---

#### **Spacer**
Vertical whitespace to add breathing room.

| Property | Type | Example |
|----------|------|---------|
| `height` | CSS length | "2rem", "40px", "5em" |
| `cls` | CSS class | "" |

**Use for:** Margins, spacing adjustments, layout breathing

---

## Editing Block Content

### Visual Mode

1. **Click a block** to select it
2. Edit properties in the right inspector panel
3. For **multi-line fields** (text, items lists):
   - **Ctrl+Enter** or click outside to save
   - **Enter** alone creates a line break
4. For **single-line fields** (title, price):
   - **Enter** saves immediately

### Code Mode

1. Click **Code** in the toolbar
2. Edit the raw Astro/JSX markup
3. Use **Ctrl+Enter** to commit multi-line changes
4. Click **Visual** to return

---

## CSS Classes & Custom Styling

Every block supports a `cls` property for adding custom CSS classes:

```
<block>
  ...
  cls: "text-large bg-gradient rounded-lg shadow-lg"
```

You can:
- Use your site's custom CSS classes (from `public/styles/zephus-custom.css`)
- Add Tailwind classes if your project uses Tailwind CSS
- Reference design tokens (e.g., `--zephus-accent`)

---

## Tips for Effective Blocks

✅ **Keep text concise**: Short, punchy copy performs better  
✅ **Use sections for grouping**: Organize blocks into logical sections  
✅ **Test mobile view**: Preview on different screen sizes  
✅ **Images with alt text**: Always add descriptive alt text for accessibility  
✅ **Meaningful links**: Use clear button text (not "click here")  
✅ **Consistent hierarchy**: Use heading levels 1–6 in order  

---

**Need help?** See [Workflows](./WORKFLOWS.md) for step-by-step tutorials or [Troubleshooting](./TROUBLESHOOTING.md) for common issues.
