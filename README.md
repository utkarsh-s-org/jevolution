# jevolution

A living, pixel-art ecosystem where AI-controlled rabbits and wolves compete, communicate, and reproduce. Watch how model decisions and response times play out in a shared 64×64 habitat.

jevolution makes Jev and other models' behavior observable: select an animal to follow it, inspect its actual provider response, switch to the normalized game action, and see measured latency alongside its traits and vitals.

## Explore the ecosystem

- **Configurable animal groups.** Choose providers and models for rabbit and wolf groups, adjust starting populations, and compare up to six groups. Wolves can also use a deterministic controller. Their fixed or dynamic population setting is independent of their controller.
- **A shared environment.** Animals navigate food patches, water, forests, mountains, and burrows. Rabbits can forage, carry and share food, shelter, flee, and seek mates. Dynamic wolves hunt, spend energy, reproduce with a mate, and can die of hunger or old age.
- **Local communication.** Rabbits can signal danger (`!`), food (`+`), follow me (`>`), or need food (`?`). Nearby signals inform decisions; receiving a signal does not force an animal to obey it.
- **Optional A2A food tasks.** In the model arena, enable food-delivery requests between two agent services. Models can accept or decline; only a physical food transfer completes a task. Inspect the request, decisions, receipt and replay in **Cooperation**. [Setup and boundaries](docs/a2a-cooperation.md).
- **Inherited traits.** Rabbit offspring inherit mutated combinations of parental speed, vigilance, thrift, fertility, and sociability. These traits have mechanical benefits and costs.
- **Editable maps.** Pause and use the pencil tool to paint terrain, food, trees, mountains, water, and burrows, with undo/redo and an explicit apply step. Seeded generation and a randomize button provide alternative starting habitats.
- **Live inspection and replay.** Follow animals, inspect returned decisions and rejected/late responses, zoom, or enter fullscreen. Pause to scrub recorded frames in both Habitat and Analytics; resuming continues from the latest state.
- **Analytics and field notes.** Track populations, individual trait distributions, communication-related behavior, and decision timing. Field notes contain event logs; Field guide explains the mechanics, equations, and variable meanings.
- **Environmental pressure.** Trigger a drought and observe how animals respond to changing resources.

## Run locally

Use Node.js **22.12 or newer** and npm.

```bash
git clone https://github.com/xrhuang10/jevolution.git
cd jevolution
npm install
cp arena.env.example .env.arena
```

Fill in `.env.arena` with keys for the providers you intend to use:

| Provider           | Environment variable |
| ------------------ | -------------------- |
| Jev                | `TYPESAFE_API_KEY`   |
| Anthropic / Claude | `ANTHROPIC_API_KEY`  |
| OpenAI             | `OPENAI_API_KEY`     |
| Google / Gemini    | `GEMINI_API_KEY`     |

The default rabbit groups use Jev and Claude. Other keys are only needed when selecting those providers. The example file also contains default model IDs; provider-specific model presets are available in Settings.

```bash
npm run arena:build
npm run arena
```

Open **[http://127.0.0.1:4317](http://127.0.0.1:4317)**. Use the gear to configure groups and timing, then start the ecosystem. Settings for a new run take effect when you reset the habitat.

Keys stay on the server, and `.env.arena` is ignored by Git. Starting a model-controlled simulation makes real API calls using your accounts. Configure the request and duration limits in Settings; pause to stop new decisions. The runtime also pauses when its last viewer disconnects.

To use another port:

```bash
ARENA_PORT=4318 npm run arena
```

Stop the server with **Ctrl+C**. After changing source files, rebuild and restart to load the new code. Export the current run before resetting or restarting; the browser's rewind controls operate on the current run, not an automatic session restore.

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

If Start reports missing keys, check that `.env.arena` is beside `package.json` and covers every model provider in the selected roster. If the UI appears stale after a change, rebuild and refresh the browser.

## License

[MIT](LICENSE). See the repository's license and asset notices for applicable terms.

## Hosted run password

The public site can be explored without signing in. Start and Unlock ask for a shared
password before hosted model calls are allowed. Set `ARENA_ACCESS_CODE` to at least
24 random characters in the Vercel project's Production and Preview environments.
Keep it server-only, outside Git, and never prefix it with `VITE_`.

The server verifies the password and every model request. Successful login creates a
one-hour signed, HttpOnly, Secure, SameSite=Strict cookie. Lock pauses this browser's
simulation and clears its cookie. Expired sessions pause on their next model request.
Changing the secret and redeploying invalidates all existing sessions. Share the
password only with people allowed to spend the configured API credits.

This is shared-password access control, not per-user billing or a global spending cap.
Local `npm run arena` remains a loopback development server using your local keys;
it does not use hosted password authentication.
