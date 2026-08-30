# Fork Fighter pixel style guide

## Direction

Fork Fighter is a bright 16-bit runner under hostile live direction. The game
is the hero surface; the game masters appear only as a terse executor signal
when a patch is selected or applied.
Hard edges, stepped motion, limited color ramps, and square drop shadows keep the
Phaser scene and React HUD in one visual language.

## Palette

| Token | Hex | Purpose |
| --- | --- | --- |
| Deep navy | `#17214A` | Outlines, text, UI frames |
| Night navy | `#0A1230` | Hard shadows and track depth |
| Sky blue | `#79D7FF` | Runner world background |
| Action blue | `#58A6FF` | Architect and neutral actions |
| Relay mint | `#5EE7B7` | Relay, safety, success, extraction |
| Patch pink | `#F45AA5` | Gremlin, incoming patches, hazards |
| Core gold | `#FFD166` | Cores, selection, timers, highlights |
| Warm cream | `#FFF4D6` | High-contrast UI surface and sprites |

Every gameplay role uses both color and shape. Cores are diamonds, the relay is
a square tower, extraction is an arch, hazards are squat blobs, and the player
has a forward scarf and asymmetric running silhouette.

## Player character

The player is a compact heroic runner built from deterministic Phaser pixel
blocks: cream angular helmet, narrow mint visor, cobalt suit, mint gloves and
boots, one gold belt pixel, and a magenta scarf trailing opposite travel. This
silhouette stays brighter and more directional than the evil game masters.

The renderer supports five explicit view-model motions:

- **Idle:** subtle two-pixel breathing and visor blink.
- **Run:** alternating arms and legs, four-pixel body bounce, scarf follow-through.
- **Jump:** tucked knees, raised arms, small rotational arc.
- **Dash:** compressed horizontal pose, extended limbs, three stepped speed trails.
- **Hit:** recoil angle, short positional shake, warning pixels, brief flicker.

These are presentation states. The scene never chooses a motion from physics,
health, collision, or input; it only renders `player.motion`.

## Typography

Press Start 2P is bundled locally from `@fontsource/press-start-2p` under the
SIL Open Font License. Use it for labels and numeric readouts. Longer patch
descriptions use the local monospace fallback at a larger size for legibility.

## Motion

- Use `steps()` for DOM animation; never interpolate sprites into soft motion.
- World motion runs leftward: speed lines and clouds reinforce forward travel.
- Player motion timing follows the state list above; cores bob, hazards squash,
  and relay and exit lights pulse.
- Incoming patches bounce by a few pixels and flash gold/magenta.
- `prefers-reduced-motion` collapses decorative CSS animation.

## Game-master identities

- **Architect:** hooded blue owl-machine tactician with narrow cyan eyes.
- **Gremlin:** magenta imp with pointed ears, fangs, and glitch embers.
- **Auditor:** mint enforcement drone with one severe horizontal scan eye.

They are minimal antagonists with strong silhouettes. Only the active, next, or
last executor appears; never expose the full roster or internal activity feed to
the player.

## Executor rail

The right rail is deliberately narrow. It may show one portrait, executor name,
patch name, state, and an incoming countdown. Validation gates, difficulty
scores, proposal history, and other masters belong in developer tooling. The
reserved three-pixel cue at the bottom marks where a later execution animation
can be attached without expanding the information surface.

## Pixel rules

- Phaser enables `pixelArt`, disables anti-aliasing, and rounds rendered pixels.
- Raster assets must use transparent gutters and `image-rendering: pixelated`.
- UI borders are 2–4 px with offset hard shadows; avoid blur and rounded corners.
- Decorative icons are built from blocks or pixel glyphs, not smooth SVGs.
