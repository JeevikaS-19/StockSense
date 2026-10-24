# StockSense design system

Professional lab-management software: data-forward, calm, easy to scan for senior users. Colour is used for meaning (status, action, attention), not decoration. Flat surfaces, light borders, no gradients.

## Colour swatches

| Swatch | Name | Hex | Used for |
| --- | --- | --- | --- |
| Navy | Primary | `#1a365d` | Top bar, table headers, primary buttons, headings, KPI accent stripe |
| Navy hover | Primary hover | `#142b4d` | Primary button hover |
| Teal | Accent 1 | `#0891b2` | Data lines, links, focus rings, active sidebar edge |
| Teal tint | Selected and hover background | `#f0f9ff` | Active sidebar item, row hover, subtle highlights |
| Emerald | Accent 2 (success) | `#059669` | Good metrics, "in stock", received, approved (text `#047857`, tint `#ecfdf5`) |
| Amber | Accent 3 (warning) | `#d97706` | Low stock, budget warning (text `#b45309`, tint `#fffbeb`) |
| Rose | Accent 4 (error) | `#e11d48` | Out of stock, errors, destructive actions (hover `#be123c`, tint `#fff1f2`) |
| Slate 50 | Background | `#f8fafc` | Page background, zebra rows |
| Slate 200 | Border | `#e2e8f0` | Card and divider borders |
| Slate 300 | Input border | `#cbd5e1` | Input borders |
| Slate 400 | Hint text | `#94a3b8` | Placeholder, disabled, hints |
| Slate 500 | Secondary text | `#64748b` | Labels and captions |
| Slate 600 | Body text | `#475569` | Body copy |

## Typography

- Font: Inter, with the system stack as fallback.
- Headings: navy `#1a365d`, semibold to bold.
- Body: `#475569`, 1.5 line height.
- Numbers: tabular figures, so columns line up.

## Components

**Buttons**
- Primary (save, submit, approve): navy background, white text, 4px radius. Hover `#142b4d`.
- Secondary (cancel, view): white background, slate border, navy text. Hover light teal.
- Destructive (reject, delete, archive): rose background, white text. Hover `#be123c`.
- Disabled: 50% opacity, default cursor.
- Pressed: a 2% scale-down, nothing else moves.

**Cards and KPI tiles**
- White, 1px slate border, 8px radius, a small shadow.
- KPI tiles add a 3px navy stripe across the top.
- Hierarchy: label (small, slate 500), number (large, bold, navy), hint (small, slate 500).

**Status badges**
- Stock: In stock (emerald), Low stock (amber), Out of stock (rose).
- Orders: Draft (grey), In progress (teal), Received (teal-green), Rejected or cancelled (rose).

**Inputs**
- 1px slate-300 border, 6px radius, white background.
- Focus: teal border with a soft teal ring.
- Errors: rose text under the field.

**Tables**
- Navy header with white bold text.
- White rows with zebra striping in `#f8fafc`.
- Hover: teal tint.
- Only row dividers, no column lines.

**Navigation**
- Sidebar: white, slate border on the right. Inactive items slate 500. Active item: teal tint background, navy text, teal edge on the left. Icons navy.
- Top bar: navy, with the lab switcher and user menu in white. The notifications bell is cyan with a rose count badge.

**Modals**
- Navy header with white title. Close button turns white on hover.
- Body on white, buttons aligned right.

**Charts**
- Solid lines only: in teal `#0891b2`, out amber `#d97706`.
- Grid lines `#e2e8f0`. Axis labels slate 500.

## Motion

Short and quiet: panels fade and rise 8px in 0.35s, colour changes take 0.15s, progress bars fill in 0.7s. Everything stops when the system asks for reduced motion.
