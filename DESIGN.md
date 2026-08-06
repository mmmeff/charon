---
name: Charon
description: A solarized signal poster for the review control room.
colors:
  ink: "#050607"
  paper: "#F3EBDD"
  paper-dim: "#B8B1A7"
  coral: "#FF574D"
  cobalt: "#216DFF"
  electric-blue: "#75B6FF"
  signal-yellow: "#FFC95C"
  field-green: "#126B58"
typography:
  display:
    fontFamily: "Archivo Variable, Helvetica Neue, sans-serif"
    fontSize: "clamp(3.6rem, 10vw, 6rem)"
    fontWeight: 900
    lineHeight: 0.84
    letterSpacing: "-0.04em"
  body:
    fontFamily: "Archivo Variable, Helvetica Neue, sans-serif"
    fontSize: "1rem"
    fontWeight: 450
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "Archivo Variable, Helvetica Neue, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.08em"
  monospace:
    fontFamily: "IBM Plex Mono, SFMono-Regular, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "normal"
rounded:
  frame: "2px"
  control: "999px"
spacing:
  xs: "0.5rem"
  sm: "0.875rem"
  md: "1.5rem"
  lg: "clamp(2rem, 5vw, 5rem)"
  xl: "clamp(5rem, 12vw, 11rem)"
components:
  button-primary:
    backgroundColor: "{colors.coral}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0.9rem 1.4rem"
  frame-dark:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.frame}"
    padding: "{spacing.md}"
---

## Overview

Charon is a solarized signal poster.

The site borrows the behavior of damaged analog video without drawing its hardware. Solarized color, hard signal tears, clipped luminance, optical bloom, halftone breakup, and magnetic color errors act on an otherwise flat editorial page.

Charon's moon is the image.
The product is the evidence.

The category default is a terminal-themed developer landing page. Refuse it.

## Logo and Icon

One moon.
One point of light.

The Charon mark pairs a coral-and-cobalt moon with one eight-point optical starburst. The app icon crops that moon hard inside an ink tile. The standalone mark keeps the complete orb on transparency.

Halftone breakup, film grain, dust, and imperfect color registration are part of the mark. Preserve the raster masters. Do not trace them into clean vectors.

The moon must remain the dominant silhouette at every size. The starburst is a signal, not decoration.

Do not use the retired cube.
Do not add letters, arrows, rings, or extra stars.

## Colors

Ink owns the page.

Coral and cobalt take whole fields, not tiny accents. Electric blue blooms at image edges. Signal yellow marks warnings and active evidence. Green belongs to the rare successful state.

Paper is warm. Never pure white.

Color fringing, halftone dots, film grain, and signal tears belong to raster imagery and large color fields. Core text stays sharp.

## Typography

Self-hosted Archivo Variable carries the short, blunt claims. Its width axis supplies condensed metadata and wide display text.

Archivo Variable carries navigation, body copy, captions, and controls. Use sentence case except for compact control labels and film metadata.

Self-hosted IBM Plex Mono carries code, event names, and terminal output. Monospace does not carry the brand.

## Layout

The wide layout behaves like a radical editorial poster interrupted by product evidence.

Coral owns the first viewport. A colossal solarized moon fragment collides with oversized black type. The product enters as one hard rectangular cutout. It has no device frame, window mockup, or simulated physical housing.

The review workflow compresses into one black signal strip. Six bounded pieces of product evidence connect through one coral line.

The cobalt gap section is the major color break. Black data and type cut through it without a secondary dark card. One oversized raster starburst breaks across its lower boundary.

On narrow screens, the hero remains one continuous color field. The product follows the claim, and the reel scrolls horizontally with the next frame exposed.

## Application

The application is an Operate surface.
The brand supports the review task and never competes with evidence.

Ink owns the working canvas.
Warm paper carries primary text.
Coral identifies human actions.
Cobalt identifies navigation, selection, and focus.
Signal yellow marks waiting or warning.
Green and red remain reserved for pass and fail.

The moon and raster starburst appear in launch, loading, empty, and transition states.
They do not sit behind diffs, logs, comments, settings, or form labels.

Primary actions use coral pills with a two-pixel cobalt registration offset.
Panels, inputs, diff frames, and secondary controls use hard two-pixel corners.
State badges may use pills because their compact silhouette distinguishes status from action.

The rail and top strip may carry low-contrast raster grain.
Reading surfaces remain flat and sharp.
Do not use CSS dot grids, fuzzy tracking bands, or ASCII backdrops.
Ambient motion is limited to the ordered-dither aether behind PR identity, selected PR rows, and branded pauses.
It freezes under reduced motion and never sits behind diffs, logs, comments, controls, or form labels.

Neutral lines describe structure.
Do not trace panels, cards, or rows with brand colors.
Selection uses a cobalt field.
Status uses a tinted fill and glyph.
Coral borders appear only as focus or direct manipulation feedback.

Application depth comes from stepped ink surfaces and soft offset shadows.
Hard cobalt registration belongs to the launcher image and primary action, not every popover or card.

Each working view gets one dominant anchor.
PR views use an oversized warm-paper identity slab.
Launch views use the moon and coral field at poster scale.
Selected PRs remain ink.
A living coral-cobalt aether field breaks in from the trailing edge instead of filling the card with flat cobalt.
Active navigation may use a stronger cobalt field, but surrounding panels stay neutral so the field remains singular.

Major application color fields are optically printed, not digitally flat.
`docs/signal-texture.webp` carries the shared halftone breakup, stochastic dithering, scratched emulsion, dust, and coral-cobalt misregistration.
Use it on static launcher color, the PR identity slab, active navigation, primary action, and running-agent header.
Do not place it behind diffs, logs, comments, settings forms, or long prose.

Animated aether fields are low-resolution canvases.
They quantize coherent energy ribbons through a fixed Bayer matrix into ink, cobalt, electric blue, coral, and signal yellow.
The field moves.
The dither matrix does not.
This keeps the shimmer atmospheric without turning it into crawling scanline noise.

Application type uses a fixed scale.
Body text starts at 14px.
Metadata starts at 13px.
Labels start at 11px.
Mono remains limited to code, refs, paths, logs, and measured values.

## Elevation & Depth

Depth comes from optical registration and hard overlap.

Use offset cobalt or coral channel displacement. Do not use neutral floating-card shadows. Grain sits over imagery and colored fields, never over small text.

## Shapes

Image cuts are square or nearly square with hard corners.

Pill shapes are reserved for actions and state chips. Eight-point optical starbursts mark transitions, inflection points, and moments of developer control.

Starbursts are raster art with halftone breakup, film grain, optical bloom, and imperfect color registration. Do not recreate them with CSS geometry or inline SVG.

VHS is image behavior.
Never draw a cassette, CRT, control panel, timecode, tracking label, or fake broadcast interface.

## Components

Primary actions are coral pills with ink text. The hover state shifts the button by two pixels and exposes a cobalt offset.

Feature groups use a signal strip, caption rail, or full color field. They do not use equal rounded cards.

Screenshots remain honest product evidence. They enter as hard rectangular cutouts. Filters must not obscure the UI.

The terminal demonstration is a technical insert. It stays monospace and gains the same frame, grain, and registration language as the rest of the page.

## Do's and Don'ts

Do make Charon's moon the first image and final afterimage.

Do use starbursts sparingly as the primary registration glyph.

Do use crop, scale, asymmetry, and negative space with confidence.

Do let the coral and cobalt fields get loud.

Do keep the product offer and download action visible in the first viewport.

Do express analog video through color drift, luma clipping, hard registration tears, and raster damage.

Don't bring back ASCII as the main identity.

Don't use neon glows as a substitute for composition.

Don't scatter tiny accent colors across an otherwise neutral page.

Don't use literal VHS hardware, media-player controls, or skeuomorphic broadcast equipment.

Don't fabricate customer proof, metrics, or endorsements.
