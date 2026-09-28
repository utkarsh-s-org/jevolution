# Local predator–prey mechanism experiments

Baseline: the local main checkout at 6b7870f, with the experiment-reporting change ported to its shared runtime. All mechanism switches default off. Preview-only sliders remain unapplied design metadata; the separate **Active mechanism experiments** controls change the engine on reset. The branches are stacked local checkpoints; switches let you compare each mechanism independently. Nothing is pushed or merged to main.

## 2. Demographics

Opposite-sex eligible adults must meet. The mother carries a gestation; offspring record two distinct parents, and inherit both rabbit gene vectors. Parent energy is reserved at conception for the newborns. Dependent young stay with the nest, receive nearby parent energy transfers, cannot make API decisions, and cannot immediately disperse or hunt. Juveniles move more slowly; dispersal happens on maturity. Founder age, sex and death-age variation use a separate deterministic stream, preserving original map, positions and genes. Pregnant animals cannot conceive again. Dead mothers cannot give birth.

Closed populations have no arrivals. Optional boundary immigration enters from unoccupied walkable edge tiles, respects population caps and exhausts an explicit source of 20 rabbits / 10 wolves. It does not teleport beside residents. Local crowding replaces global rabbit carrying-capacity suppression, while hard safety caps remain.

The qualitative mechanisms follow real mammal development; numerical parameters are experimental, compressed simulation units. Rabbit gestation/dependency/maturity: 12/6/24s, litter up to 3; wolf: 24/12/45s, litter up to 2. Lifespan targets 480/720s with ±20% individual variation. These are not measured species parameters or consistent seconds-to-calendar conversions. Seasonal breeding, territorial packs, detailed lactation/nest behavior and sex-specific mortality remain unmodeled. This is a transparent mechanism experiment, not a validated ecological prediction.

Qualitative sources checked 2026-09-28: [NPS wolf ecology](https://www.nps.gov/yell/learn/nature/wolf.htm), [Connecticut DEEP cottontails](https://portal.ct.gov/deep/wildlife/fact-sheets/cottontail-rabbits). Wolves and generic rabbits remain an illustrative trophic pairing, not a field-calibrated Yellowstone food web.

Validation uses the user's genuine recorded starting world, run c950cce7-7dce-4192-9230-163da09cd6c4, seed 8675309, followed by new actual Jev executions. No invented model responses or synthetic evaluation cases. Existing repository unit checks are software correctness checks, not ecological validation. Paid evaluation accounting, source hashes, complete journals, replays and per-variant results live outside the repo in outputs/mechanism-experiments. Single executions are exploratory; API timing and decisions can vary.

## 3. Hunting, finite resources and habitat

An attack costs 0.6 energy and has 0.8s recovery on success or failure. Interference is sampled at attempts, not every physics update. Predator movement costs 0.18 energy/tile. A killed rabbit leaves a finite carcass containing 65% of its remaining energy; wolves consume it at 8 energy/s while within 1.2 tiles, with competition and decay (0.2 energy/s). Death no longer provides an instant energy bonus. Remaining, consumed and decayed carcass energy are auditable. These coefficients are explicit experiment assumptions, not measured conversion efficiencies.

Burrows protect the first two occupants by entry time (ID resolves exact ties); overflow is visible and vulnerable. Wolves have thirst and shoreline drinking actions. Each water tile holds at most 100 hydration units; drinking removes units, drought drains 2 units/s and recovery refills 0.4/s. This is a finite reservoir approximation, not a hydrological model. Water and mountains remain impassable; full terrain-aware routing is still simplified. Starting food is 75% of baseline and normal regrowth is halved. Drought reduces regrowth and withers exposed grass. Carcasses render in the habitat.

This switch changes resource and predation assumptions together; it cannot attribute a population change to one coefficient. Use it to assess the mechanism family, then isolate individual coefficients in follow-up experiments. No parameters were selected to force persistent population waves or a model winner.
