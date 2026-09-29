# jevolution

A living, pixel-art ecosystem where AI-controlled rabbits and wolves compete, communicate, and reproduce. Watch how model decisions and response times play out in a shared 64×64 habitat.

jevolution makes Jev and other models' behavior observable: select an animal to follow it, inspect its actual provider response, switch to the normalized game action, and see measured latency alongside its traits and vitals.

## Explore the ecosystem

- **Configurable animal groups.** Choose providers and models for rabbit and wolf groups, adjust starting populations, and compare up to six groups. Wolves can also use a deterministic controller. Their fixed or dynamic population setting is independent of their controller.
- **A shared environment.** Animals navigate food patches, water, forests, mountains, and burrows. Rabbits can forage, carry and share food, shelter, flee, and seek mates. Dynamic wolves hunt, spend energy, reproduce with a mate, and can die of hunger or old age.
- **Local communication.** Rabbits can signal danger (`!`), food (`+`), follow me (`>`), or need food (`?`). Nearby signals inform decisions; receiving a signal does not force an animal to obey it.
- **Inherited traits.** Rabbit offspring inherit mutated combinations of parental speed, vigilance, thrift, fertility, and sociability. These traits have mechanical benefits and costs.
- **Editable maps.** Pause and use the pencil tool to paint terrain, food, trees, mountains, water, and burrows, with undo/redo and an explicit apply step. Seeded generation and a randomize button provide alternative starting habitats.
- **Live inspection and replay.** Follow animals, inspect returned decisions and rejected/late responses, zoom, or enter fullscreen. Pause to scrub recorded frames in both Habitat and Analytics; resuming continues from the latest state.
- **Analytics and field notes.** Track populations, individual trait distributions, communication-related behavior, and decision timing. Field notes contain event logs; Field guide explains the mechanics, equations, and variable meanings.
- **Environmental pressure.** Trigger a drought and observe how animals respond to changing resources.

## Run locally

Use Node.js **22.12 or newer** and npm.

```bash
git clone https://github.com/utkarshg20-org/jevolution.git
cd jevolution
npm install
npm run arena:dev:api
```

In a second terminal:

```bash
npm run arena:dev
```

Open **[http://127.0.0.1:5174/arena.html](http://127.0.0.1:5174/arena.html)**. Click **API keys** to enter your provider credentials. Use the gear to configure groups, environment, and timing, then reset the habitat to apply settings. Starting a run makes billable API calls on your accounts. Set request and duration limits before starting. Switching away from the tab pauses the simulation.

Keys are saved in this browser's localStorage, separately from run data. Export the current run before resetting or reloading. Stop the development servers with **Ctrl+C**.

The legacy loopback server (`npm run arena:build` followed by `npm run arena`) supports private development with a Git-ignored `.env.arena`. Do not expose that server publicly; the public deployment uses the isolated BYOK endpoint instead.

## What the comparison measures

All model-controlled animals select from the actions available in their local observations. Jev returns structured answers; the Claude adapter requests a tool call. The inspector distinguishes the **provider-native response**, **normalized game action**, and **engine-written description**. It does not present engine descriptions as model reasoning.

Real-time mode lets API latency affect when decisions arrive. Equalized timing provides a controlled comparison window. The inspector reports API round-trip time separately from additional simulation timing holds.

A seed reproduces the starting habitat and animal placement, not live provider responses or network timing. For comparisons, keep populations, terrain, timing rules, and resource settings consistent and repeat across seeds. One successful run does not establish model superiority or guarantee that cooperation will emerge.

## Science behind the simulation

jevolution is a spatial, individual-based simulation. Population changes come from discrete births and deaths; resource availability, position, energy, traits, and asynchronous decisions influence those events.

It can illustrate predator–prey feedback, but it does **not** numerically solve the classical Lotka–Volterra equations or guarantee sinusoidal population cycles. Traits evolve through inheritance, mutation, and differential survival/reproduction; model weights remain fixed. There is no reinforcement-learning training loop during a run.

The **Field guide** tab explains these distinctions alongside the implemented population balances, resource rules, communication mechanics, and trait tradeoffs.

## Development

The simulation-specific code lives in:

| Location                    | Purpose                                                                    |
| --------------------------- | -------------------------------------------------------------------------- |
| `core/src/evolution/`       | World generation, movement, ecology, traits, actions, and shared types     |
| `server/src/evolution/`     | Provider adapters, decision scheduling, API routes, recordings, and replay |
| `webview-ui/src/evolution/` | Habitat renderer, editor, inspector, analytics, and Field guide            |
| `arena.env.example`         | API-key and default-model configuration template                           |
| `logs/evolution/`           | Local run logs and replay data generated by the server                     |

Run the simulation checks:

```bash
npm run arena:check
npm run arena:build
npx playwright install chromium
npm run arena:ui
```

The browser suite uses deterministic fixtures and does not call model providers. To use an installed Google Chrome instead of Playwright's Chromium, run `ARENA_BROWSER_CHANNEL=chrome npm run arena:ui`.

If Start reports missing keys, open API keys and add a key for each model provider in the selected roster. If the UI appears stale after a change, rebuild and refresh the browser.

## License

[MIT](LICENSE). See the repository's license and asset notices for applicable terms.

## Public runs: bring your own keys

Use **API keys** in the header to save provider keys on your device. No password or owner-funded API key is used by the hosted endpoint. Every model request requires the visitor's key. Keys stay out of run configuration, replay, exports, and server logs. **Forget keys** removes browser storage and pauses the worker. Saving keys also pauses active runs.

Device storage is localStorage, not an encrypted vault: scripts executing on this origin can access it. Use restricted provider keys and provider spending limits. Keys travel over HTTPS through our server for each provider request and are not persisted there. Only the selected provider key is transmitted, in a request header. Never add third-party scripts to this origin without reviewing their access to keys.

To run the public BYOK interface locally, run these in separate terminals:

```sh
npm run arena:dev:api
npm run arena:dev
```

Open http://127.0.0.1:5174/arena.html. The existing local server command above remains available for private development; it must not be exposed publicly.

## Active experiment controls

All experiment controls apply when resetting the habitat and are included in exported configuration. Legacy records marked preview-only retain their original, unapplied meaning.

Opening settings does not activate experiment overrides. Untouched controls and changes to timing alone preserve the selected scenario's rules, starting populations, seeded food, and random sequence. Experiment defaults use that scenario's wolf vision and configured starting roster. Switching scenarios resets experiment overrides to the new preset.

- Communication: sociability scales the selected maximum range from 37.5% to 100%. Delay is simulation milliseconds; message loss is a seeded draw per emission. Cost is the selected base times (1 + sociability). Lost messages still cost energy. Signal lifetime begins at delivery.
- Resources: abundance scales capacity and initial food. Clustering blends uniform supply with generated patches, preserving total capacity. Regrowth scales replenishment independently.
- Temperature: an illustrative model with a 20 C reference. Each degree colder increases base rabbit and wolf metabolism 2%; each degree hotter increases rabbit thirst 4%. Food growth decreases 2.5% per degree away from 20 C, floored at 10%. These are experiment assumptions, not validated animal physiology.
- Drought: regular 60-second events at the selected frequency per simulation hour. Partial coverage uses a seeded center; full coverage preserves the original global drought. Strength is relative to the scenario: 100% keeps its drought regrowth and withering, 0% removes the growth reduction and withering, and 200% stops regrowth and doubles withering. Intermediate strengths interpolate between these values. Food-regrowth and temperature multipliers apply afterward. Automatic droughts are disabled at zero frequency; manual drought uses the same strength and area.
- Predators: starting count is divided among configured wolf groups (0 to 20), overriding their starting counts. Speed scales the scenario baseline; vision is in tiles. Population may subsequently change through births, deaths, and scenario immigration.
- Inheritance: mutation probability applies separately to each trait. Starting diversity rescales founder traits around 0.5, with the existing 0.05 to 0.95 bounds. Model weights stay fixed.

The Field Guide's original equations describe the baseline. Experiment parameters override those baseline rules.
