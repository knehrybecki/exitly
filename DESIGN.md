---
version: alpha
name: Exitly
belongs: Developer desktop utility — ProtonVPN country exits for Docker. Dark harbor atmosphere: deep teal-black canvas, cream ink, single lime signal accent from the brand mark. UI reads like a focused control surface — Raycast/Linear density with Exitly nautical identity, not a marketing landing page.
description: |
  Exitly is a dark-first Electron control panel. One continuous deep-teal canvas (#071412 → #0b2e2d), cream primary text (#f4f7ed), and a single chromatic accent — brand lime (#c4d600) — reserved for primary CTAs, connection signal, and focus. Surfaces are charcoal-teal panels with hairline borders. Typography mixes geometric Sora for UI chrome with IBM Plex Mono for code/IP/snippets. Radius stays tight (6–12px). No purple gradients, no heavy glow stacks, no pill-everything chrome.
source: Adapted for Exitly from patterns in VoltAgent/awesome-design-md (Raycast + Linear structure) with Exitly brand colors from brand/icon.png.

colors:
  canvas: "#071412"
  canvas-deep: "#050f0e"
  surface: "#0d1f1d"
  surface-elevated: "#122826"
  surface-card: "#152e2b"
  hairline: "rgba(244, 247, 237, 0.10)"
  hairline-strong: "rgba(244, 247, 237, 0.18)"
  ink: "#f4f7ed"
  ink-muted: "#a8b5a8"
  ink-subtle: "#6f7f72"
  accent: "#c4d600"
  accent-soft: "rgba(196, 214, 0, 0.14)"
  accent-ink: "#0b2e2d"
  brand-teal: "#0b2e2d"
  ok: "#5dce8e"
  ok-soft: "rgba(93, 206, 142, 0.14)"
  warn: "#e0b84a"
  warn-soft: "rgba(224, 184, 74, 0.14)"
  danger: "#ff7a66"
  danger-soft: "rgba(255, 122, 102, 0.14)"
  code-bg: "#050c0b"

typography:
  display:
    fontFamily: Sora
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -0.04em
  heading:
    fontFamily: Sora
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: -0.02em
  body:
    fontFamily: Sora
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: -0.01em
  label:
    fontFamily: Sora
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: 0.06em
    textTransform: uppercase
  button:
    fontFamily: Sora
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.01em
  mono:
    fontFamily: "IBM Plex Mono"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.45

rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px

spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 32px

components:
  button-primary:
    background: "{colors.accent}"
    text: "{colors.accent-ink}"
    radius: "{rounded.md}"
    height: 36px
    padding: 0 14px
  button-ghost:
    background: transparent
    text: "{colors.ink}"
    border: "{colors.hairline}"
    radius: "{rounded.md}"
  button-danger:
    background: "{colors.danger-soft}"
    text: "{colors.danger}"
    border: "rgba(255, 122, 102, 0.35)"
    radius: "{rounded.md}"
  panel:
    background: "{colors.surface}"
    border: "{colors.hairline}"
    radius: "{rounded.lg}"
    padding: 18px
  input:
    background: "{colors.canvas-deep}"
    border: "{colors.hairline}"
    radius: "{rounded.md}"
    focus-border: "rgba(196, 214, 0, 0.55)"
  status-dot-on:
    color: "{colors.ok}"
  status-dot-off:
    color: "{colors.ink-subtle}"
  code-block:
    background: "{colors.code-bg}"
    border: "{colors.hairline}"
    radius: "{rounded.md}"
    font: "{typography.mono}"
---

# Exitly DESIGN.md

Design system for the Exitly desktop app and any future web surfaces. Agents should treat this file as source of truth for look and feel.

Inspired by structure from [awesome-design-md](https://github.com/voltagent/awesome-design-md) (Raycast / Linear density), remapped to Exitly brand.

## 1. Visual Theme & Atmosphere

- **Mood:** Quiet harbor control room — precise, dark, trustworthy.
- **Density:** Product UI, not marketing. Tight spacing, clear hierarchy, one job per panel.
- **Identity:** Brand lime is the “signal” (connected / primary action). Cream ink on deep teal is the default reading surface.
- **Motion:** Short, purposeful (150–220ms). Status pulse only when connected. No decorative parallax.

## 2. Color Palette & Roles

| Token | Hex | Role |
|-------|-----|------|
| Canvas | `#071412` | App background |
| Surface | `#0d1f1d` | Panels |
| Elevated | `#122826` | Nested chips / tabs active |
| Ink | `#f4f7ed` | Primary text (cream from logo) |
| Muted | `#a8b5a8` | Secondary copy |
| Accent | `#c4d600` | Primary CTA, focus, brand signal |
| Accent ink | `#0b2e2d` | Text on lime buttons |
| OK | `#5dce8e` | Connected |
| Warn | `#e0b84a` | Checking / transitional |
| Danger | `#ff7a66` | Disconnect / errors |

**Rules**

- Never use purple/indigo gradients.
- Lime appears on primary actions and connection affordances only — not as large fills behind whole sections.
- Borders stay hairline and low-contrast; elevation comes from surface steps, not multi-layer shadows.

## 3. Typography

- **UI:** [Sora](https://fonts.google.com/specimen/Sora) — geometric, modern, readable at small sizes.
- **Code / IP / paths:** IBM Plex Mono.
- **Display:** Sora 600, tight tracking (−0.04em). Brand name “Exitly” is the hero signal in the header — do not overpower it with a competing headline.
- Avoid Inter, Roboto, Arial, and system-ui as primary faces.

## 4. Component Stylings

### Buttons

- Primary: lime fill, dark teal label, 8px radius, height ~36px.
- Ghost: transparent + hairline border.
- Danger: soft red wash + red text (Disconnect).
- No full-pill (9999px) buttons for primary chrome — prefer `md` radius.

### Panels

- Surface fill, 1px hairline, 12px radius, light backdrop blur optional.
- One purpose per panel (status+connect | snippets | activity).

### Inputs / select

- Deep canvas fill, hairline border, lime focus ring (border color, not glow stack).

### Tabs

- Segmented row; active = elevated surface + ink; inactive = muted text.
- Radius 8px, not pills.

### Code blocks

- Near-black teal (`#050c0b`), mono 12px, copy action as ghost button below.

### Status

- 12–14px dot: warn (checking), ok+soft pulse (connected), muted (off).

## 5. Layout Principles

- Max content width ~960px, centered, padding 24–28px.
- Two-column main grid on desktop (≥860px): status/connect | connect-any-app.
- Activity log full width below.
- Spacing scale: 4 / 8 / 12 / 16 / 24 / 32.

## 6. Depth & Elevation

1. Canvas (flat)
2. Panel surface
3. Nested (ip-box, code, chips)
4. Transient (update banner with soft accent wash)

Shadow: single soft layer `0 16px 40px rgba(0,0,0,0.28)` max — never stacked glam shadows.

## 7. Do's and Don'ts

**Do**

- Lead with brand mark + “Exitly” as the strongest header signal.
- Keep lime scarce and meaningful.
- Prefer monospace for anything copy-paste or network-related.
- Preserve existing Electron structure and IPC; restyle, don’t rewrite architecture.

**Don’t**

- Don’t add dashboard stat strips, badge clusters, or floating promo chips.
- Don’t introduce a second accent color family (no purple, no cyan competing with lime).
- Don’t use cream warm paper backgrounds or terracotta accents.
- Don’t put large inset hero imagery inside cards — this is a utility surface.

## 8. Responsive Behavior

- <860px: single column stack.
- Touch targets ≥36px height for primary controls.
- Log panel can shrink; never hide Connect / country select.

## 9. Agent Prompt Guide

Quick reference for UI work:

- Canvas `#071412`, surface `#0d1f1d`, ink `#f4f7ed`, accent `#c4d600`
- Fonts: Sora + IBM Plex Mono
- Radius 8–12px; hairline borders; lime primary buttons
- Prompt: “Restyle Exitly desktop renderer to match DESIGN.md — dark teal harbor control panel, cream type, lime signal CTAs, tight Raycast-like density, keep all existing IDs and behavior.”
