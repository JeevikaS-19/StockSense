# StockSense design system

Green and beige: calm, trustworthy lab software. Forest green is the primary colour, beige is the surface. Gradients and clay depth are kept gentle. Colour carries meaning (status, action, attention).

## Colour swatches

| Swatch | Name | Hex | Used for |
| --- | --- | --- | --- |
| Forest green | Primary | `#2f6b4f` | Primary buttons, data lines, focus rings, KPI accent |
| Deep green | Headings and top bar | `#1f4d3a` | Headings, top bar, active text |
| Green hover | Hover | `#255a43` | Primary button hover |
| Sage | Secondary accent | `#6f9a84` | Progress fills, secondary highlights |
| Green tint | Selected and hover background | `#e9f1ec` | Active sidebar item, row hover |
| Beige | Page background | `#f6f0e6` | Page and sidebar background, zebra rows |
| Beige deep | Muted fill | `#ece3d3` | Badges, avatars, muted panels |
| Surface | Cards and inputs | `#fffcf7` | Cards, inputs |
| Line | Borders | `#e6dccb` | Card and divider borders |
| Line strong | Input borders | `#d2c5ad` | Input borders |
| Amber | Warning | `#c98a1b` (text `#91600f`, tint `#fbf3e0`) | Low stock, budget warning, stock out |
| Rose | Error | `#c2412d` (hover `#a8351f`, tint `#fbeae6`) | Out of stock, errors, destructive actions |
| Emerald | Success | `#3e8e63` (text `#2f7050`, tint `#e8f4ec`) | In stock, received, approved |
| Body text | Body | `#5c5344` | Body copy |
| Muted | Hints | `#8f8573` | Placeholders, captions |

## Typography

- Font: Inter, with the system stack as fallback.
- Headings: deep green `#1f4d3a`, semibold to bold.
- Body: `#5c5344`, 1.5 line height.
- Numbers: tabular figures, so columns line up.

## Surfaces and depth

- Background: beige with a faint sage and gold aura behind the page (two large, heavily blurred blobs at low opacity).
- Clay cards: a gentle cream gradient, a 1px beige border, a light inner highlight on the top-left, and a soft warm shadow. On hover they lift by 2px.
- Primary buttons: a soft green gradient with a light top highlight and a green-tinted shadow.

## Components

**Buttons**
- Primary (save, submit, approve): green gradient, white text, 10px radius. Hover darkens to deep green.
- Secondary (cancel, view): surface background, beige border, deep green text. Hover green tint.
- Destructive (reject, delete, archive): rose gradient, white text.
- Disabled: 50% opacity, default cursor.
- Pressed: a 2% scale-down.

**Cards and KPI tiles**
- Clay surface, 14px radius.
- KPI tiles add a 3px green stripe across the top.
- Hierarchy: label (small, muted), number (large, bold, deep green), hint (small, muted).

**Status badges**
- Stock: In stock (emerald), Low stock (amber), Out of stock (rose).
- Orders: Draft (beige), In progress (green tint), Received (emerald), Rejected or cancelled (rose).

**Inputs**
- Surface background, 1px line-strong border, 8px radius, soft inset shadow.
- Focus: green border with a soft green ring.

**Tables**
- Green header with cream bold text.
- Surface rows with beige zebra striping.
- Hover: green tint. Row dividers only.

**Navigation**
- Sidebar: beige, with a thin border. Inactive items muted. Active item: green tint, deep green text, green edge on the left.
- Top bar: deep green, with cream text. The notifications bell is gold, with a rose count badge.

**Modals**
- Green header with cream title. Body on the surface colour.

**Charts**
- Solid lines: in forest green, out amber. Grid in the line colour, labels muted.

## Motion

Gentle: cards and panels rise 10px over 0.45s, colour changes take 0.2s, progress bars fill over 0.8s. Motion stops when the system asks for reduced motion.
