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

## 4. Decisions, perception and communication

The active predator–prey prompt describes the actual reproduction/resource rules, including automatic solo births when demographics is off. Menus omit unnecessary rabbit mating actions in that baseline population-rate mode. Menu shuffling uses its own deterministic stream, so it does not consume birth/capture randomness. Wolf update order rotates to reduce stable array-position advantage.

Personal sensing/memory updates every 0.5 world seconds independently of API dispatch. Routes are constrained to terrain the animal has seen. Neighbor energy is quantized to 25-point estimates and carried food to presence/absence. Sight still uses terrain occlusion; local sound uses distance, so hearing is separate from seeing. These are simplified sensors, not species-specific sensory calibration or learned spatial cognition.

Actions can persist up to 2s before reconsideration; urgent danger or unmet needs can interrupt. Completed/invalidated behavior can request a fresh decision. Waiting intentionally under an action commitment is excluded from queue delay. Rabbits and wolves may send optional local signals; wolves can follow a visible wolf that invited followers. Messages have IDs connecting sender, observed message and chosen response in the real decision journal. A communication-off switch removes received messages and permits only the none signal.

The optional lineage goal explicitly asks for long-term local lineage survival rather than only the individual's immediate gain. This is an experimental agent objective, not a claim that animals reason about a species-wide common good. An individual/descendants objective is also selectable. Actual messages and following are measured; instructions do not guarantee cooperation or benefits. This internal simulation communication is separate from the parallel A2A implementation and does not claim A2A compliance. Territory, packs, deception learning and biological signaling vocabularies remain future species-specific work.

## 1. Research clock and timing fairness

The original real-time mode remains available. Research mode gathers a cohort of living eligible animals from one world state, freezes their observations, and keeps biological time paused while the cohort's requests finish. A global concurrency allowance controls transport load. Returned actions are staged and committed in a stable rotating order, rather than HTTP arrival order. The engine advances 2 world seconds in fixed 50ms steps, stopping exactly at the requested horizon. Cohort size and network speed change elapsed wall time, not the biological time between decision opportunities. Initial per-animal dispatch staggering, speed scaling and equalized response holds do not set research time.

This is a distinct experimental clock, not a faster API and not a guarantee that repeated model calls choose the same actions. Optional action commitments and dependent offspring still determine eligibility. A 15s provider timeout or provider failure pauses the entire round; partial staged actions are cancelled. A request allowance insufficient for a complete cohort stops the experiment explicitly before dispatching a partial round. Actual queue waiting is recorded in wall milliseconds; research-mode simulation queue time is zero while the clock is held.

The first live research attempt returned HTTP 402 at time zero on 2026-09-28. It is retained as a failed provider execution, not a biological result. Recorded-response scheduler verification deliberately reuses real captured decisions with changed completion order, checks identical observations and biological state, and tests cancellation. This checks orchestration correctness only; it does not substitute for fresh research-clock model-quality runs.
