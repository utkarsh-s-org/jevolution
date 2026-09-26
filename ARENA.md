# Evolution Arena

A running, server-authoritative rabbit ecosystem built in the Pixel Agents fork. The default roster is ivory Jev and brown Claude Haiku rabbits; run settings support up to six rabbit/wolf groups. Wolves default to the **Deterministic** rule-based controller and can optionally use an AI model. Grass and water belong to neither lineage.

## Run locally

Requires Node 22.16+ (for `node:util.parseEnv`; Node 26 was used during development).

```sh
cd "$HOME/Downloads/Evolution Arena"
npm ci --ignore-scripts
cp -n arena.env.example .env.arena
# Fill TYPESAFE_API_KEY and ANTHROPIC_API_KEY in .env.arena using your editor.
npm run arena:build
npm run arena
```

Open http://127.0.0.1:4317. The habitat is initially paused. Click **Check keys** after filling the file, then **Start ecosystem**. No key is sent to the browser. The server binds only to the local machine; closing the last viewer pauses calls. The original Pixel Agents office and its scripts remain available.

To generate a new map, pause the ecosystem, open **Run settings**, click **Randomize seed** (or enter your own number), and choose **Reset habitat with these settings**. Randomize only changes the pending seed; reset applies it and clears the current run. Export first to preserve the current snapshot.

## What was reused

Pixel Agents' React/Vite workspace, Canvas 2D animation loop (`startGameLoop`), nearest-neighbor sprite rendering convention, Y-sorted entities, four-neighbor BFS movement contract, Fastify dependencies, and pixel font. The office-specific hooks, terminal spawning, and transcript scanning are not run by `npm run arena`. The new ecosystem rules live in `core/src/evolution`, the model adapters and authoritative clock in `server/src/evolution`, and the interface in `webview-ui/src/evolution`.

This follows the existing 2D renderer: stepped cliffs and shaded scenery create depth, without introducing a rotatable 3D engine. The generated character and scenery atlases are under `webview-ui/public/evolution`. Full image prompts are recorded in `docs/evolution-assets.md`.

## Habitat and physical rules

- **64 × 64 tiles**, rendered at a base 16 pixels per tile. This is an abstract game scale, not a claim that one tile equals a meter.
- **Starting budgets: 80 rabbits and 10 wolves**, split across their own species groups. Adding/removing groups redistributes that species budget; counts can be redistributed between groups. At least one rabbit group is required. Removing every wolf group creates a predator-free run. Rabbit groups receive the same seeded gene sequence (identical distributions at equal counts, matched prefixes otherwise). Maximum 180 living rabbits.
- The habitat seed generates asymmetric lakes, ponds, forest patches, mountain ridges, burrows, food patches, and animal positions. The same seed reproduces the same starting world in this version; maps from the earlier fixed-layout generator are not reproduced by seed alone.
- Lakes and ponds block travel. Adjacent land tiles permit drinking. No swimming.
- Forests, lakes, and mountain ridges can extend to any map edge; there is no grass corridor or fixed mountain border. Ridges block movement and sight. Short passes or land bridges connect isolated land only where needed, preserving islands and keeping all walkable land, burrows, and accessible shores connected.
- Up to ten wolves start at random, separated positions. Rabbits spawn on unique grass tiles at least six tiles from a wolf. Both lineages share the whole map; resource access and predator exposure are not equalized.
- Forest slows both rabbits and wolves, occludes distant observations, and helps rabbits hide. Six rabbit burrows block wolf attacks but provide no food or water; remaining there indefinitely eventually exhausts resources.
- Food grows in 12–16 seeded, irregular patches with varying per-tile capacities, including less productive forest undergrowth. Ground outside those patches has zero food capacity. Rabbits share each tile’s finite supply, so groups deplete it faster. Empty patches refill linearly over about 200 simulation seconds in normal conditions; drought reduces growth to 16% of that rate. A 60-second drought reduces regrowth and increases hydration loss for both lineages.
- Five inherited traits in [0.05, 0.95], each initialized from the same [0.2, 0.8] distribution. A child takes the mean of its two parents plus an independent uniform mutation of at most ±0.065 per gene.

| Trait       | Benefit                        | Cost enforced by engine        |
| ----------- | ------------------------------ | ------------------------------ |
| Speed       | Faster travel and escape       | More basal and movement energy |
| Vigilance   | Wider local vision (4–9 tiles) | More basal energy              |
| Thrift      | Lower basal energy use         | Slower travel and eating       |
| Fertility   | Shorter breeding cooldown      | More parental energy per birth |
| Sociability | Wider local signal range       | More energy per signal         |

These are abstract physiological/behavioral parameters, not claims about measured rabbit genetics. Wolves use either deterministic hunting rules or a configured AI controller. They seek visible prey within 10 tiles, travel at 1.55 tiles/second on grass, capture within 0.6 tiles, rest for 18 seconds after a catch, and never read lineage color. Forest multiplies both rabbit and wolf speed by 0.77. Grass is a resource, not an agent.

Both parents must choose each other, be mature (25 seconds), have at least 62 energy and 35 water, be within 1.7 tiles, have finished breeding cooldown, and have no wolf within four tiles. Both pay energy. Offspring inherit the same model lineage; cross-lineage breeding is intentionally excluded as a simplified controller-transmission rule. “Deepest generation” means pedigree depth, not synchronized global generations. Births, deaths, and trait distributions demonstrate dynamics; no generation count or winner is scripted.

## Decisions and latency

Each rabbit receives its local energy, hydration, genes, visible wolves and neighbors, audible signals, and legal action candidates. Options are concrete reachable goals drawn from forage, drink, rest, explore, flee, hide, mate, and follow. Models choose one candidate plus `none`, `danger`, `food`, or `follow`. The models do not move entities or change physical rules.

Jev uses `POST https://api.typesafe.ai/v1/systemone` with Choice questions. Claude uses `POST https://api.anthropic.com/v1/messages` with a forced `choose_action` tool. Defaults: **jev-1.13.0** and **claude-haiku-4-5-20251001**. Haiku was chosen as a fast comparison rather than deliberately selecting a slow reasoning model. Model IDs are frozen for the duration of a run. Changing them requires a reset. Model overrides belong in `.env.arena`; models that reject forced tool use require an adapter change. Failed calls are visible and pause both lineages after repeated failures, with immediate stops for configuration/authentication failures.

Default real-time deadline: 2,500 ms; four simultaneous calls per lineage; 100 ms between completed decisions for each animal; maximum 20,000 requests or 600 seconds per run. These are initial demo settings, **not latency measurements or experimentally optimized thresholds**. A rabbit continues its last accepted action while inference is pending. Late, obsolete, malformed, and failed replies are counted separately. Never substitute a rule-based rabbit policy under a Jev/Claude label.

- API latency is observed network round-trip time, including service queue time and response parsing.
- Rabbit scheduling queue time is separate; it starts when that rabbit becomes eligible for a decision.
- Optional added delay per model group is recorded separately from API latency.
- Equal-timing mode holds each successful response until the same configured delay after its observation. Replies arriving later are rejected. This controls action timing but does not equalize all network, queue, trajectory, or prompt effects.
- Local signals take 200 ms, last six seconds, cost energy, and respect visibility/range. Both lineages can hear them; there is no telepathic team channel. Signal truth is not guaranteed.
- A stalled host (>1 second between ticks) pauses rather than silently treating laptop sleep as model latency. Closing the viewer also pauses.

## Evidence and limits

Every real request saves its actual local observation, legal candidates, selected decision, returned model ID, timing, usage, and application outcome in ignored `logs/evolution/<run-id>.jsonl`. The initial world and run configuration are saved separately. Export downloads the current state and aggregate observations. Logs are local and are not uploaded anywhere except the game observations required by the chosen model APIs.

There are **no synthetic model-evaluation cases, fabricated latencies, prerecorded results, or fallback rabbits pretending to be live models**. Mechanics tests exercise the deterministic engine and are not evidence of model quality. A live run cannot be verified without keys for the selected providers. The displayed API cost estimate uses documented rates for the pinned defaults and excludes unreported usage from interrupted/failed requests. Changed model names show no estimate.

Population dominance alone does not establish a model advantage. Report multiple genuinely recorded runs with seeds/configs, equal-timing controls, swapped model assignments to the same starting positions and additional delay controls before making a comparative claim. The current interface provides repeatable seeds and timing/delay controls; automatic tournaments, experiments with swapped model assignments, statistical analysis, are follow-ups. This is a simplified selection demonstration, not a validated biological forecast. Five-to-ten generations in one short demo are not guaranteed.

Food-rich tiles have darker green ground and grass tufts; depleted productive tiles show bare brown soil. The food display follows the live amount, so grazing and regrowth are visible. These are initial gameplay parameters, not measurements of real rabbit ecology.

## Checks

```sh
npm run arena:check
npm run arena:build
npm run lint
```

API credentials are intentionally not supplied by the project. Add keys locally; do not paste them into chat or commit them. Original MIT license and attribution are preserved. The public fork initially contains upstream code; local changes are not pushed automatically.

Sources checked September 24, 2026: [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents), [TypeSafe API](https://docs.typesafe.ai/api), [Jev models and rates](https://docs.typesafe.ai/models), [Claude model list](https://platform.claude.com/docs/en/models/overview), [Claude tool definitions](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools).

### Personal memory and voluntary following

All rabbit model groups use the same bounded memory, updated from their own visible surroundings at decision time: up to 4 food locations (120 simulation seconds), 2 water locations (180 seconds), and 4 wolf sightings (20 seconds). Observations include each sighting’s age and the last seen food amount; unseen resources and wolves are never refreshed from global state. Visible depleted food is forgotten. Nearby resource tiles are consolidated. Offspring start with empty memory.

Models can choose to revisit remembered resource locations, then inspect and choose to eat or drink. Signals identify their sender but do not become confirmed memories. Visible neighbors expose current action, movement, and heading, not hidden destinations. A chosen follow action tracks a visible rabbit of either lineage and stops when it leaves sight. No signal automatically causes following, and no recruitment strategy is scripted. These are simulation design limits, not measured rabbit cognition.

## Replay and configurable model groups

Pause the ecosystem to enable the timeline below the map. Drag the slider or use **Previous frame / Next frame** to inspect recorded states. **Return to latest** restores the live view; **Resume latest state** continues the actual world, never a historical branch. Map sprites, resources, population, traits, inspector and counters use the selected frame together. No model calls happen during scrubbing.

Frames are captured on each server update (nominally 50 ms), plus start/pause/drought boundaries. The slider steps through recorded updates, not browser animation frames. Exact snapshot deltas and periodic keyframes are stored in compressed chunks under `logs/evolution/<run-id>.replay/`; only the current chunk and one read cache stay in memory. Reloading the browser retains the active run’s replay. Reset begins a new timeline; older recording files remain on disk. The UI currently browses the active run, not archived runs. Runs created before this feature cannot be reconstructed into exact replays from decision logs alone.

Run settings have two independently collapsible sections: Rabbits and Wolves. Expanding a species shows all its model groups and controls. Each species summary shows its group and animal counts. Add rabbit or wolf groups, choose the controller, select provider/model from dropdowns, and set color or optional model response delay. Both species sections start collapsed; adding a group or changing its species opens the destination section. Choosing a model fills its API ID and group name automatically; no strings need to be typed. Existing custom model configurations remain visible as the current model. Reset applies the roster, which remains fixed throughout that run. Multiple groups may use the same provider or model. A selected AI group with a missing provider key blocks Start; deterministic wolf groups require no key and never dispatch API calls; provider failures pause all groups rather than substituting another model. The global request cap and per-group concurrency still apply. There is no 2× simulation-speed change.

| Provider  | Server environment key | Adapter                                      |
| --------- | ---------------------- | -------------------------------------------- |
| TypeSafe  | TYPESAFE_API_KEY       | SystemOne choice API                         |
| Anthropic | ANTHROPIC_API_KEY      | Messages with forced choose_action tool      |
| OpenAI    | OPENAI_API_KEY         | Responses with strict choose_action function |
| Google    | GEMINI_API_KEY         | GenerateContent with ANY function calling    |

Presets include Jev, Claude Haiku 4.5, Claude Sonnet 4.6, GPT-5.6 Luna, and Gemini 3.8 Flash. Availability still depends on the API account. Custom models must support their provider adapter; unsupported IDs fail visibly. Luna uses reasoning effort `none` for this short action selection task; other models use provider defaults. Token limits are 512 for Anthropic and 2048 for OpenAI/Google. Provider defaults differ, so these controls do not make the comparison a controlled intelligence benchmark.

**Follow / chose other** counts accepted decisions where a follow action was available. It appears per rabbit and per group. Failed or late responses do not count. Choosing a different action may reflect hunger, danger, or another priority; it is not a cooperation score or inherited trait.

Provider contract references: [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling), [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [Gemini function calling](https://ai.google.dev/gemini-api/docs/generate-content/function-calling?authuser=1&hl=en), [Gemini model IDs](https://ai.google.dev/gemini-api/docs/models). New provider adapters are covered by transport fixtures; live OpenAI and Google calls require local keys and have not been verified.

## Validation

`npm run arena:check` covers ecosystem mechanics, model adapter contracts, and exact replay reconstruction. After `npm run arena:build`, run `npx playwright install chromium` and `npm run arena:ui` to verify replay scrubbing, roster settings, and mobile layout with deterministic browser fixtures. These checks never start paid model calls. Screenshots are written to `test-results/arena`; GitHub Actions remains disabled; run these checks locally.

## Wolf controllers

**Deterministic** selects a visible, eligible same-group mate when ready to breed (prioritizing a wolf that has already chosen it); otherwise it uses nearest-visible-prey hunting and seeded patrol rules. **AI model** uses the same four provider adapters as rabbits, with wolf-specific instructions and local observations. It can rest, patrol a visible reachable destination, hunt a visible rabbit, or choose an eligible same-group mate. Chosen prey is tracked only while visible; losing sight clears the chase. Shelters exclude attacks and hiding forest rabbits are visible only within two tiles. Both controllers share movement, terrain slowdown, capture distance, and the 18-second eating cooldown. Wolf **Births and deaths** is a separate setting from **Controller**. **Enabled — mating, hunger, aging** is the default for both deterministic and AI wolves. **Disabled — immortal, no offspring** holds their population constant for control experiments. Deterministic wolves can still starve, age, and reproduce when births and deaths are enabled.

AI wolves share the run's request cap and timing/deadline rules, with the same per-group concurrency as rabbits. Invalid, late, cancelled, and failed responses do not turn into deterministic actions. Wolf calls carry species and animal IDs in the local decision logs. Wolf groups appear in population histories, exact replays, catch counters, latency panels, and the map legend. Pixel markers identify wolf-group colors; clicking a wolf opens its inspector.

Deterministic describes the rule controller with seeded randomness. A complete run with live API calls is still sensitive to response timing, so the label does not promise identical end-to-end model-driven outcomes.

### Wolf life cycle

In dynamic mode, wolves begin with 60 energy, lose 0.6 energy/second plus 0.1 per tile moved, and gain 45 per catch (capped at 100). They starve at zero energy and die after age 240 seconds. Birth now requires two living wolves from the same group, each at least 30 seconds old, with at least 95 energy and no reproduction cooldown. They must choose each other as mates and meet within 1.7 tiles with a free neighboring land tile. A catch alone never produces offspring. Each parent pays 50 energy and receives a 45-second reproduction cooldown. The child records both parents, starts with 35 energy and age zero, inherits their group/controller, and has generation one greater than the older generation of its parents. AI wolves must each choose the mating action; deterministic wolves choose through coded rules. Mating targets track only visible, eligible partners and clear when the partner disappears or another action is chosen. This does not model sexes, gestation, genetic wolf traits or realistic wolf timescales. The global wolf cap is 32; initial settings still allocate at most ten wolves.

API calls for dead animals are cancelled. New AI-controlled offspring enter the same decision scheduler. After rabbits go extinct, dynamic wolves continue aging and starving until none remain, or the run's time/request limit is reached. Fixed control wolves do not keep an otherwise extinct ecosystem running.

Charts display deterministic groups with readable gray statistics and dashed gray population lines, alongside a “Deterministic · no API calls” label. This denotes the controller, not disabled biology. Dynamic groups show actual births/deaths; fixed groups show population and catches without irrelevant birth/death rows. The inspector shows dynamic wolf energy, age, generation and reproduction cooldown. Replay records these values and population events.

See [the mathematical audit](docs/arena-mathematics.md) for exact balances and how the added predator births/deaths relate to Lotka–Volterra and Holling-type approximations. Parameters are demo mechanics, not fitted ecological estimates.

## Local validation

GitHub Actions is disabled for this repository and the inherited hosted workflows have been removed to avoid runner usage. Validate changes locally with `npm run check-types`, `npm run arena:check`, `npm run arena:build`, and `npm run arena:ui`. Local Git hooks still scan for secrets and check formatting/types.

## Edit the map

Pause the ecosystem and select the pencil beside the settings gear. Editing opens a focused workspace with the map and tools visible together: a side palette on desktop and a compact bottom dock on phones. Paint Ground (no food), Food grass (full fertile tiles), Water, or Burrow using a 1×1, 3×3, or 5×5 brush. Trees and mountains are fixed 3×3 stamps: one large object per snapped footprint, with the same size and spacing as generated terrain. Painting another terrain over any part of a tree or mountain removes the whole object. Drag paints a continuous stroke; Undo/Redo operates on whole strokes. Pan moves the view without painting, and zoom remains available. Hover previews the exact footprint and sprite placement. Command/Control-Z undoes a stroke; add Shift to redo. You can also focus the canvas, move with arrow keys, and press Enter or Space to paint.

Changes remain a preview until **Apply map**; **Cancel** discards the preview. Editing is unavailable during live simulation or while inspecting replay frames. The server independently rejects edits during a run, while calls are cancelling, or if another edit/reset has made the draft stale.

Applying does not advance time or reset populations. Animals covered by water/rock move to the nearest free land tile; wolves also move out of new burrows. Edits without enough land are rejected atomically. Current movement/actions, signals, and remembered locations are cleared so animals make fresh decisions. Existing burrow caches retain their food unless removed; new caches start empty. Map edits are recorded as interventions in the run log and replay, and included in run exports. The seed alone no longer reproduces a custom map. Reset habitat generates a new seeded map and removes custom edits; export first if you need to preserve them.
