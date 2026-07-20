# Design - Bangumi Watch Planner

A locked design system for this local planning app. All four views share this
system; future visual changes should amend this file before adding page-specific
overrides.

## Genre

Playful, expressed as restrained anime editorial design rather than neon,
science-fiction chrome, or decorative character art.

## Macrostructure

- App views: Workbench with a sticky N3 side rail on desktop and compact top
  navigation on mobile.
- Content rhythm: summary band, task surface, then dense working lists.
- Footer: Ft2 inline rule inside the desktop rail.

## Theme

- Anchor: sakura pink for active state and primary actions.
- Secondary: cyan for alternate actions and pear for warnings/status.
- Surfaces: lightly pink-tinted paper in light mode and violet-tinted ink in
  dark mode.
- Canonical values live in `tokens.css`; components consume semantic tokens
  only.

## Typography

- Display: Bricolage Grotesque, weight 600-800, upright.
- Body: Noto Sans SC, weight 400-800.
- Letter spacing: 0.
- Headings wrap within their container and never use italics.

## Spacing And Shape

- Four-point named spacing scale from `--space-3xs` through `--space-3xl`.
- Cards and controls use radii of 8px or less; count badges may use pill radii.
- Section boundaries use fine rules and compact shadows, not floating nested
  cards.

## Motion

- Short button press and subtle content-cover lift only.
- No ambient animation, gradients, bouncy easing, or automatic movement.
- `prefers-reduced-motion` removes transforms and transitions.

## Interaction Voice

- Primary command: sakura fill with high-contrast ink.
- Secondary command: cyan-tinted surface with a cyan edge.
- Ghost command: transparent surface and neutral rule.
- Every control keeps visible focus, active, disabled, and hover states.

## Content Rules

- Covers represent actual anime entries only; never reuse them as decoration.
- App views use no hero enrichment. Function and current data carry the page.
- Preserve all existing API calls, routes, labels, and task interactions.
- Light and dark modes share hierarchy, spacing, and state semantics.
