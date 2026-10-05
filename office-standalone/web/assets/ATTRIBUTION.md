# Sprite sources and runtime contract

## Existing character and pet assets

Retained from this repository's existing Pixel Agents adaptation. Upstream:
[Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents), Pablo De Lucca,
MIT. The upstream copyright and permission notice is preserved in
[PIXEL-AGENTS-LICENSE.txt](PIXEL-AGENTS-LICENSE.txt). Pixel Agents credits
[JIK-A-4 / Metro City](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack)
for the character artwork.

- `characters/char_0.png` through `char_5.png`: 112 × 96; 16 × 32 cells; three direction rows: down, up, right. Mirror right for left.
- **Columns 0, 1, 2 are walking frames.** Walk sequence: 0, 1, 2, 1. Columns 3–4 are typing; 5–6 are reading. The previous attribution incorrectly described all six non-idle columns as walking.
- `pets/claudio.png`, `pets/gitcat.png`: 96 × 96 pet sheets. The current room uses the front idle frame, not unverified animation ranges.
- `pets/sleep_cat.png`: 24 × 16 sleeping cat.

The animation contract was checked against the upstream
[sprite mapping](https://github.com/pixel-agents-hq/pixel-agents/blob/main/webview-ui/src/office/sprites/spriteData.ts).
No new character sheets were downloaded in this audit.

## Existing furniture

`DOOR` and `FISH_TANK` PNGs are
retained project assets. Repository history records furniture redesigns in
commits `22f45f0` and `6421fcb` (the latter describes PixelLab furniture).
They are not newly sourced from the reference landing page. The original
project license remains unchanged; no independent provider-license review
was performed in this audit.

Replaced utility sprites, unused furniture, idle-pet copies, and NPC sheets were removed from the
working tree; their prior versions remain available in Git history.

## New generated atlas

`furniture/studio-atlas.png` was generated for this project on 2026-10-03
using OpenAI's built-in image-generation tool. It is an RGBA PNG, **1254 ×
1254**, arranged in four equal quadrants: sofa, server rack, low bookcase,
and monstera. It was generated from a written prompt, without copying
reference-site artwork.

The exact prompt, grid, dimensions, and processing contract are in
[generated-atlas.json](generated-atlas.json). Source bytes remain intact.
At load time, `scene.js` finds the alpha bounds above threshold 32 in each
quadrant, then resamples each object once onto its logical pixel canvas.
Source alpha, nonempty cells, loaded sprites, and browser scenes were
inspected. `asset-checksums.json` identifies the final PNG files.

Logical sizes are 40 × 28 (sofa), 20 × 32 (server), 34 × 28 (shelf), and
26 × 32 (monstera). The atlas contains decoration, not animation frames.

## Matching utility atlas

`furniture/utilities-atlas.png` was generated for this project on 2026-10-03
using OpenAI's built-in image-generation tool. The unmodified 1254 × 1254
RGBA source has four quadrants: coffee cart, water cooler, floor lamp, and
wall clock. It uses the same alpha-bound normalization as the studio atlas.
The written prompt did not include reference-site artwork.

Logical sizes are 20 × 26 (coffee), 12 × 26 (cooler), 12 × 30 (lamp), and
10 × 10 (clock). The first three are placeable; the clock decorates the wall.
See [generated-utilities.json](generated-utilities.json) for the prompt and
contract, and [asset-checksums.json](asset-checksums.json) for source hashes.
All eleven placeable props have previews made from the actual runtime sprite.

## Matching cafe and plant atlas

`furniture/decor-atlas.png` was generated for this project on 2026-10-03
using the built-in ImageGen tool. Its unmodified 1254 × 1254 RGBA source has
four quadrants: walnut cafe table, sage stool, cream-potted succulent, and
terracotta planter. It was generated from a written prompt without copied
reference artwork. Logical sizes: 28 × 24, 16 × 18, 12 × 16, and 32 × 18.
See [generated-decor.json](generated-decor.json) for the exact prompt and
[asset-checksums.json](asset-checksums.json) for the source checksum.
Source transparency and all four runtime-normalized cells were visually
inspected. Desktop/mobile scene evidence for this atlas was rendered in a
CPU canvas; browser integration validation remains pending.
