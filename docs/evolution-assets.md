# Generated assets

Created with the built-in image-generation tool on September 24, 2026. Generated assets were visually inspected and saved in the project. Transparent atlas cells are cropped by their alpha bounds at render time; character art is rendered with nearest-neighbor sampling.

## Character atlas

File: `webview-ui/public/evolution/animals.png`. Four columns (idle, walk A, walk B, eating); three rows (white Jev rabbit, brown Claude rabbit, gray wolf). The renderer mirrors horizontal direction; distinct north/south poses are a future art improvement.

Prompt:

Use case: stylized-concept. Asset type: production pixel-art game character sprite atlas PNG, transparent background. Create ONE sprite sheet arranged in an EXACT 4 columns by 3 rows evenly spaced grid with NO grid lines or labels, each cell identical size. Top row: FOUR poses of the SAME small WHITE RABBIT, ivory fur, tiny charcoal eyes, soft pink inner ears. Middle row: the EXACT matching rabbit silhouette but warm BROWN fur, four matching poses. Bottom row: FOUR poses of a charcoal-gray WOLF, pointed muzzle, upright small ears, bushy tail. All characters face RIGHT, three-quarter elevated side view compatible with top-down Pixel Agents / classic 16-bit RPG tiles. Columns for each row: idle, walk legs together, walk legs extended, eating crouch. Cute clear compact silhouettes. Crisp actual pixel clusters, limited 10-color palette per animal, no gradients or anti-aliasing, chunky pixels. Each entire animal centered in its cell, feet aligned to same baseline across row, ample transparent padding. Rabbit ears must stay inside cell, wolf tail stays inside cell. Consistent scale between rabbit rows. Wolf approximately 1.4x rabbit body length. Orthographic, no perspective distortion. No terrain, scenery, grass, shadows, floor, checkerboard, lettering, frame, or watermarks. Actual transparent alpha background. Wide 4:3 overall composition.

## Terrain atlas

File: `webview-ui/public/evolution/terrain.png`. Four columns by two rows. Trees, shrubs, boulders, mountain, burrow, log, grass. Water, shoreline, and ground tile patterns are deterministic Canvas terrain, allowing exact collision geometry and neutral regrowth.

Prompt:

Use case: stylized-concept. Asset type: production 16-bit pixel-art terrain decoration atlas PNG for a top-down ecosystem game, transparent background. ONE atlas in exact FOUR columns by TWO rows, all eight cells equal size, no grid lines. Top row from left to right: a full rounded leafy oak tree with visible trunk; a tall tiered pine tree; a compact berryless leafy shrub; a cluster of three gray granite boulders. Bottom row from left to right: a chunky stepped rocky mountain peak with grass at the foot; a small earthy rabbit burrow opening in a low grassy mound; a weathered fallen log; a lush clump of meadow grass and three tiny pale wildflowers. Orthographic elevated three-quarter top-down view, like classic 16-bit RPG pixel art and Pixel Agents. Rich muted moss and sage green foliage, warm ochre earth, slate gray rock, crisp hard pixel clusters, light from upper left. Visually dimensional shapes with flat discrete shade bands, no smooth gradients. Every item centered in its own cell, complete uncut silhouette, ample transparent margin. Terrain elements only; no animals or people. Actual transparent alpha background, no floor, ground plane, shadows beyond objects, checkerboard, labels, text, borders or watermarks. Wide 2:1 overall sheet.
