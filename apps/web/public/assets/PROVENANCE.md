# Asset provenance

## `game-master-triptych.png`

- Generated on 2026-08-30 with the OpenAI built-in image generation tool for
  this project.
- No third-party reference image, logo, trademark, or existing character was
  supplied.
- Intended use: three equal pixel-art HUD portrait cells in this project.
- Attribution is not required. Keep this record with redistributed builds.

Final prompt set:

> Preserve the exact 3:1 strip, three equal portrait cells, transparent
> background, pixel edges, scale, and color identity while redesigning all three
> as minimal evil antagonists: a hooded blue owl-machine Architect with narrow
> cyan eyes; a magenta imp Gremlin with pointed ears, fangs, and two glitch
> embers; and a mint cyclopean Auditor drone with a horizontal lime scan eye.
> Authentic limited-palette 16-bit pixel art, readable at 48 px, no text, logos,
> frames, signatures, gore, weapons, or watermark.

> Remove only the generated checkerboard background and replace it with genuine
> transparent alpha. Preserve every character pixel, pose, spacing, cell order,
> geometry, and hard edge; introduce no halo or new element.

## Procedural assets

The runner, cores, relay, extraction arch, hazards, platforms, clouds, skyline,
and UI block icons are authored from Phaser Graphics and CSS in this repository.
They do not contain third-party visual material.

## Player motion concept

`apps/web/design/player-motion-concept.png` was generated with the OpenAI
built-in image generation tool as the visual reference for the runtime
character. The playable RGBA sheet is shipped as
`apps/web/public/assets/fork-fighter-runner.png`; its eight cells are four run
frames followed by idle, jump, dash, and hit. The generated checkerboard was
removed without altering the coloured character pixels.

The smoother eight-frame gameplay loop is shipped separately as
`apps/web/public/assets/fork-fighter-run-cycle.png`. It was generated from the
approved character reference on 2026-08-30 with identical costume, palette,
direction, and a strict four-by-two layout. Runtime per-frame anchors normalise
the two sheet rows to one foot baseline, preventing visible crop and position
jumps without resampling the art.

The death reaction is shipped as the isolated
`apps/web/public/assets/fork-fighter-hit.png`. It is a pixel-exact extraction of
the approved hit cell with neighbouring dash fragments removed and 14 pixels of
transparent gutter added on every edge. Keeping it outside the packed action
sheet prevents adjacent-frame texture sampling during the death transition.

Final prompt set:

> Create one 4-column by 2-row sheet with eight consistent frames of the same
> heroic right-facing runner: four-frame run cycle, idle, jump, dash, and hit.
> Cream angular helmet and visor, cobalt suit, magenta scarf, mint boots, gold
> belt pixel; authentic minimal 16-bit pixel art, identical scale and identity,
> transparent padding, no text, grid, logo, weapon, or watermark.

> Remove only the dark showcase background and glow while preserving every
> pose, pixel edge, position, costume detail, frame order, dash streak, and hit
> pixel. Replace the background with genuine transparent alpha and add nothing.

## Font and framework

- Press Start 2P is bundled through `@fontsource/press-start-2p` and licensed
  under the SIL Open Font License 1.1.
- Phaser is MIT licensed. React and Vite retain their upstream licenses.
