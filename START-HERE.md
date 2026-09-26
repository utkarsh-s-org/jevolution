# Evolution Arena — start here

Configurable model groups (Jev and Claude by default) compete in a shared Pixel Agents-style ecosystem. The project includes custom sprites, a seeded, asymmetric 64 × 64 habitat with random animal spawns, configurable wolf groups (Deterministic or AI model), local decisions, trait inheritance, reproduction, latency metrics, and drought controls.

## Run

Install Node.js 22.16 or newer, then open a terminal in this extracted folder:

```sh
npm ci --ignore-scripts
cp -n arena.env.example .env.arena
```

Add your own TYPESAFE_API_KEY and ANTHROPIC_API_KEY to .env.arena. No credentials are included in this archive.

```sh
npm run arena:build
npm run arena
```

Open http://127.0.0.1:4317, click Check keys, then Start ecosystem.

For a different map, open Run settings, click Randomize seed, then Reset habitat with these settings. Reusing a seed repeats the starting world.

Read ARENA.md for the design, trait tradeoffs, model integration, and limitations. The original upstream README is preserved for attribution; use these commands for Evolution Arena. Source: https://github.com/pixel-agents-hq/pixel-agents. Fork: https://github.com/xrhuang10/jevolution.

## Verification at handoff

The production build, 22 mechanics, replay, and provider contract checks (including 200 generated seeds), and desktop/mobile browser checks passed. Repository lint has zero errors and one existing warning in the upstream office UI. New OpenAI and Google adapters are tested with transport fixtures; live calls require their provider keys. No latency or winner is fabricated.

This archive includes the local implementation, source assets, lockfile, and MIT license. Dependencies, build output, logs, Git history, and private environment files are deliberately excluded.

## Replay and models

Pause, then drag the timeline or step one recorded frame at a time. Resume continues from the latest state. Exact replay begins with runs made after this update.

In Run settings, add up to six model groups or choose another model for an existing group, then reset to apply. Sonnet uses your Anthropic key. For OpenAI and Gemini groups, add OPENAI_API_KEY and GEMINI_API_KEY to .env.arena, respectively. Keys remain server-side.
