// Deterministic browser fixtures: never start the runtime or contact a model provider.
import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'test-results/arena');
fs.mkdirSync(artifacts, { recursive: true });
(async () => {
  const base = pathToFileURL(path.join(root, 'dist/arena-server/')).href;
  const { ArenaRuntime } = await import(base + 'server/src/evolution/runtime.js');
  const { stepWorld } = await import(base + 'core/src/evolution/simulation.js');
  const { MODEL_PRESETS, DEFAULT_CONFIG } = await import(base + 'core/src/evolution/constants.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-ui-fixture-'));
  const runtime = new ArenaRuntime(dir);
  const groups = Array.from({ length: 6 }, (_, i) => ({
    ...MODEL_PRESETS[i % MODEL_PRESETS.length],
    label: `${MODEL_PRESETS[i % MODEL_PRESETS.length].label} ${i + 1}`,
    id: `team-${i}`,
    color: i,
    delayMs: 0,
  }));
  runtime.reset(1811399735, DEFAULT_CONFIG, groups);
  for (let i = 0; i < 240; i++) {
    stepWorld(runtime.world, 0.05);
    runtime.replay.capture(runtime.snapshot());
  }
  // Recorded history differs from the latest state, so rewind must change distributions.
  const distributionRabbit = runtime.world.rabbits[0];
  distributionRabbit.genes.sociability = 0.99;
  distributionRabbit.behavior = { offered: 10, followed: 4, other: 6 };
  runtime.replay.capture(runtime.snapshot());
  runtime.replay.flush();
  let running = true;
  let controls = [];
  const state = () => {
    const s = JSON.parse(JSON.stringify(runtime.snapshot()));
    s.status.running = running;
    s.status.ready = Object.fromEntries(s.world.groups.map((g) => [g.id, true]));
    s.status.providerReady = { typesafe: true, anthropic: true, openai: false, google: false };
    return s;
  };
  const app = Fastify();
  await app.register(fastifyStatic, { root: path.join(root, 'dist/arena'), index: 'arena.html' });
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  const browser = await chromium.launch({
    channel: process.env.ARENA_BROWSER_CHANNEL || undefined,
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.EventSource = class {
      onmessage = null;
      onerror = null;
      constructor(url) {
        this.timer = setInterval(
          () =>
            fetch(url.includes('/decisions/') ? url : '/api/arena/state')
              .then((r) => r.json())
              .then((data) => this.onmessage?.({ data: JSON.stringify(data) })),
          100,
        );
      }
      close() {
        clearInterval(this.timer);
      }
    };
  });
  await page.route('**/api/arena/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/arena/decisions/')) {
      const animalId = Number(url.pathname.split('/').pop());
      return route.fulfill({
        json: { runId: runtime.runId, animalId, traces: runtime.decisions.get(animalId) },
      });
    }
    if (url.pathname === '/api/arena/map') {
      const b = route.request().postDataJSON();
      try {
        if (running) throw new Error('Pause the simulation before editing the map.');
        runtime.editMap(b.runId, b.revision, b.edits);
        return route.fulfill({ json: state() });
      } catch (e) {
        return route.fulfill({ status: 400, json: { error: e.message } });
      }
    }
    if (url.pathname === '/api/arena/control') {
      const b = route.request().postDataJSON();
      controls.push(b);
      if (b.action === 'pause') running = false;
      if (b.action === 'start') running = true;
      if (b.action === 'reset') {
        running = false;
        runtime.reset(b.seed, b.config, b.groups);
      }
      return route.fulfill({ json: state() });
    }
    if (url.pathname.startsWith('/api/arena/replay/')) {
      const i = Number(url.pathname.split('/').pop());
      if (i === 100) await new Promise((r) => setTimeout(r, 250));
      return route.fulfill({ json: { index: i, snapshot: runtime.replay.get(i) } });
    }
    return route.fulfill({ json: state() });
  });
  try {
    await page.goto(origin);
    await expect(page.getByRole('button', { name: 'Ⅱ Pause ecosystem' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit map', exact: true })).toBeDisabled();
    await expect(page.getByLabel('Replay timeline')).toBeDisabled();
    await expect(page.locator('.lineage-stat')).toHaveCount(6);
    await expect(page.locator('polyline.chart-line')).toHaveCount(6);
    await expect(page.locator('canvas')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Habitat', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('heading', { name: 'Every millisecond counts.' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Drought rescue network' })).toHaveCount(0);
    const unchanged = JSON.stringify(runtime.world);
    const controlCount = controls.length;
    await page.getByRole('button', { name: 'Analytics', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Inherited traits', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Every millisecond counts.' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Drought rescue network' })).toBeVisible();
    await expect(page.getByLabel('Inspect an animal')).toBeVisible();
    await expect(page.getByLabel('Replay timeline')).toBeDisabled();
    await expect(page.locator('.rabbit-dot')).toHaveCount(runtime.world.rabbits.length);
    const rabbitDot = page.locator(`.rabbit-dot[data-rabbit-id="${distributionRabbit.id}"]`);
    await expect(rabbitDot).toHaveAttribute('data-value', '99');
    await rabbitDot.click();
    await expect(page.locator('.distribution-inspect')).toContainText(
      `Rabbit #${distributionRabbit.id}`,
    );
    await page.getByLabel('Rabbit distribution metric').selectOption('followRate');
    await expect(rabbitDot).toHaveAttribute('data-value', '40');
    await expect(page.locator('.dot-histogram .rabbit-dot')).toHaveCount(1);
    await expect(page.locator('.distribution-missing .rabbit-dot')).toHaveCount(
      runtime.world.rabbits.length - 1,
    );
    await expect(page.locator('.distribution-inspect')).toContainText(
      'Followed 4 / 10 opportunities',
    );
    await page.getByLabel('Rabbit distribution metric').selectOption('sociability');

    await expect(page.locator('canvas')).not.toBeVisible();
    await page.screenshot({ path: path.join(artifacts, 'analytics-desktop.png'), fullPage: true });
    await page.evaluate(() => window.scrollTo(0, 110));
    await expect(page.locator('.topbar')).toHaveCSS('background-color', 'rgb(17, 25, 20)');
    const navOnTop = await page.evaluate(() => {
      const bar = document.querySelector('.topbar');
      return bar.contains(document.elementFromPoint(innerWidth / 2, 20));
    });
    if (!navOnTop) throw new Error('Content is covering the sticky navigation');
    await page.screenshot({
      path: path.join(artifacts, 'opaque-navigation.png'),
      clip: { x: 0, y: 0, width: 1440, height: 160 },
    });
    await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.getByRole('button', { name: 'Field notes', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.locator('.event-log')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Selection needs consequences.' })).toHaveCount(
      0,
    );
    await page.getByRole('button', { name: 'Field guide', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Field guide', exact: true })).toBeVisible();
    await expect(page.locator('.event-log')).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Selection needs consequences.' }),
    ).toBeVisible();
    await expect(page.getByLabel('Equation variable legend')).toHaveCount(5);
    await page
      .getByText('How this relates to the classic predator–prey model', { exact: true })
      .click();
    await expect(page.locator('.guide-equation').filter({ hasText: 'dR/dt' })).toBeVisible();
    await page.getByText('Is this evolutionary reinforcement learning?', { exact: true }).click();
    await expect(
      page.getByText('The arena does not train a policy', { exact: false }),
    ).toBeVisible();
    await page.locator('#guide-population').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(artifacts, 'field-guide-equations.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('link', { name: '04 / Inheritance & learning' }).click();
    await expect(page.locator('#guide-evolution')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: path.join(artifacts, 'field-guide-mobile.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.getByRole('button', { name: 'Habitat', exact: true }).click();
    await expect(page.locator('canvas')).toBeVisible();
    if (JSON.stringify(runtime.world) !== unchanged || controls.length !== controlCount)
      throw new Error('Changing views changed the simulation');
    await page.getByRole('button', { name: 'Fit habitat' }).click();
    // Measure painted terrain pixels, not the size of the surrounding canvas.
    const terrainSize = () =>
      page.locator('canvas').evaluate((canvas) => {
        if (!canvas.width || !canvas.height) return 0;
        const ctx = canvas.getContext('2d');
        const ratio = canvas.width / canvas.getBoundingClientRect().width;
        const background = ctx.getImageData(0, 0, 1, 1).data;
        const widths = [0.3, 0.5, 0.7].map((fraction) => {
          const row = ctx.getImageData(
            0,
            Math.floor(canvas.height * fraction),
            canvas.width,
            1,
          ).data;
          const painted = [];
          for (let x = 0; x < canvas.width; x++) {
            if ([0, 1, 2].some((c) => row[x * 4 + c] !== background[c])) painted.push(x);
          }
          return painted.length ? (painted.at(-1) - painted[0] + 1) / ratio : 0;
        });
        return widths.sort((a, b) => a - b)[1];
      });
    await expect(page.getByRole('button', { name: 'Previous frame', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Next frame', exact: true })).toHaveCount(0);
    await expect(
      page.locator('.map-controls').getByRole('button', { name: 'Enter fullscreen', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.habitat-command .habitat-chart')).toBeVisible();
    await expect(page.locator('.habitat-details .habitat-chart')).toHaveCount(0);
    const sizes = [];
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 1536, height: 864 },
      { width: 2048, height: 1048 },
    ]) {
      await page.setViewportSize(viewport);
      const previousTerrain = ((viewport.height - 290) * 1024) / 1094;
      // The visible legend now reserves space inside the stage rather than below the viewport.
      const legendHeight = await page
        .locator('.habitat-caption')
        .evaluate((el) => el.getBoundingClientRect().height);
      await expect.poll(terrainSize).toBeGreaterThan(previousTerrain * 1.22 - legendHeight);
      await expect(page.getByLabel('Map legend')).toBeInViewport({ ratio: 1 });
      await expect
        .poll(async () => {
          const box = await page.locator('canvas').boundingBox();
          const width = await terrainSize();
          return box.width - width <= 100 + legendHeight && box.y <= 80;
        })
        .toBe(true);
      const painted = await terrainSize();
      const fittedCanvas = await page.locator('canvas').boundingBox();
      if (
        Math.abs(fittedCanvas.width - fittedCanvas.height) > 3 ||
        fittedCanvas.width - painted > 3
      )
        throw new Error('Fitted terrain must fill its square without gutters');
      const timelineRow = await page.locator('.habitat-panel .replay-controls').evaluate((el) => {
        const selectors = [
          '.replay-heading > span',
          '.replay-heading > small',
          'input',
          '.replay-buttons',
        ];
        const centers = selectors.map((selector) => {
          const r = el.querySelector(selector).getBoundingClientRect();
          return r.y + r.height / 2;
        });
        return Math.max(...centers) - Math.min(...centers);
      });
      if (timelineRow > 3) throw new Error('Replay controls must share one row');
      await expect(page.getByLabel('Replay timeline')).toBeInViewport();
      await expect(page.getByRole('button', { name: 'Open run settings' })).toBeInViewport();
      sizes.push({
        ...viewport,
        previousTerrain: Math.round(previousTerrain),
        terrain: Math.round(painted),
      });
      await page.screenshot({ path: path.join(artifacts, `habitat-${viewport.width}.png`) });
    }
    fs.writeFileSync(path.join(artifacts, 'terrain-sizes.json'), JSON.stringify(sizes, null, 2));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Enter fullscreen' }).click();
    await expect(page.locator('.arena-app')).toHaveClass(/is-fullscreen/);
    await expect(page.getByRole('button', { name: 'Exit fullscreen' })).toBeVisible();
    await expect(page.getByLabel('Replay timeline')).toBeInViewport();
    await expect(page.getByRole('img', { name: 'Population chart' })).toBeVisible();
    await page.screenshot({ path: path.join(artifacts, 'habitat-fullscreen.png') });
    await page.getByRole('button', { name: 'Exit fullscreen' }).click();
    await expect(page.locator('.arena-app')).not.toHaveClass(/is-fullscreen/);
    // Embedded browsers may reject native fullscreen. The viewport fallback must work too.
    await page.evaluate(() => {
      window.originalRequestFullscreen = Element.prototype.requestFullscreen;
      Element.prototype.requestFullscreen = () => Promise.reject(new Error('Embedded browser'));
    });
    await page.getByRole('button', { name: 'Enter fullscreen' }).click();
    await expect(page.locator('.arena-app')).toHaveClass(/is-fullscreen/);
    await page.keyboard.press('Escape');
    await expect(page.locator('.arena-app')).not.toHaveClass(/is-fullscreen/);
    await page.evaluate(() => {
      Element.prototype.requestFullscreen = window.originalRequestFullscreen;
    });
    await page.screenshot({ path: path.join(artifacts, 'six-models.png'), fullPage: true });
    // Mocked decision telemetry: illustrative transport values, not model performance evidence.
    await page.setViewportSize({ width: 1536, height: 864 });
    const subject = runtime.world.rabbits.find(
      (r) =>
        r.lineage === groups[0].id &&
        r.x > 8 &&
        r.x < 56 &&
        r.y > 8 &&
        r.y < 56 &&
        [...runtime.world.rabbits, ...runtime.world.wolves].every(
          (other) => other.id === r.id || Math.hypot(other.x - r.x, other.y - r.y) > 2,
        ),
    );
    if (!subject) throw new Error('Fixture needs an isolated rabbit for selection');
    const trace = {
      id: 'ui-decision-fixture',
      animalId: subject.id,
      species: 'rabbit',
      lineage: subject.lineage,
      label: groups[0].label,
      provider: groups[0].provider,
      model: groups[0].model,
      startedAt: Date.now(),
      simulationTime: runtime.world.time,
      deadlineMs: 2500,
      delayMs: 0,
      timing: 'realtime',
      state: 'requesting',
    };
    runtime.decisions.update(trace);
    await page.getByRole('button', { name: 'Fit habitat' }).click();
    const subjectCanvas = await page.locator('canvas').boundingBox();
    const tileSize = Math.min(subjectCanvas.width, subjectCanvas.height) / 64;
    await page.mouse.click(
      subjectCanvas.x + (subjectCanvas.width - 64 * tileSize) / 2 + subject.x * tileSize,
      subjectCanvas.y + (subjectCanvas.height - 64 * tileSize) / 2 + (subject.y - 0.5) * tileSize,
    );
    const decisionPanel = page.getByRole('region', { name: 'Live decisions' });
    await expect(decisionPanel).toBeVisible();
    await expect(
      decisionPanel.getByRole('heading', { name: `Rabbit #${subject.id}` }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Following · stop camera' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(decisionPanel.getByText('Waiting for response', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Request elapsed time')).toBeVisible();
    await expect(page.getByLabel('Decision JSON', { exact: true })).toHaveCount(0);
    runtime.decisions.update({
      ...trace,
      state: 'applied',
      decision: { choice: 'rest', signal: 'none' },
      latencyMs: 237,
      effectiveMs: 239,
      action: 'Rest and conserve energy',
    });
    await expect(page.getByLabel('Decision JSON', { exact: true })).toContainText(
      '"choice": "rest"',
    );
    await expect(decisionPanel.getByText('237 ms', { exact: true })).toBeVisible();
    await expect(decisionPanel.getByRole('button', { name: 'Native', exact: true })).toBeDisabled();
    const recordedNative = {
      format: 'Structured answers',
      truncated: false,
      json: JSON.stringify({ action: { choice: 'rest' }, signal: { choice: 'none' } }, null, 2),
    };
    runtime.decisions.update({
      ...runtime.decisions.get(subject.id)[0],
      nativeResponse: recordedNative,
    });
    await expect(page.getByLabel('Provider-native response', { exact: true })).toContainText(
      '"action"',
    );
    await expect(
      decisionPanel.getByRole('button', { name: 'Game action', exact: true }),
    ).toBeVisible();
    await expect(decisionPanel.getByRole('region', { name: 'Traits and vitals' })).toBeVisible();
    await expect(decisionPanel.locator('.organism-gene')).toHaveCount(5);
    await expect(page).toHaveTitle('jevolution — A living decision experiment');
    runtime.decisions.update({
      ...runtime.decisions.get(subject.id)[0],
      state: 'error',
      decision: undefined,
      message: 'Provider returned an invalid choice',
      nativeResponse: { ...recordedNative, json: '{"action":{"choice":"invented"}}' },
    });
    await expect(decisionPanel).toContainText('Rejected · invalid provider decision');
    await expect(page.getByLabel('Decision JSON', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Provider-native response', { exact: true })).toContainText(
      'invented',
    );
    runtime.decisions.update({
      ...runtime.decisions.get(subject.id)[0],
      state: 'applied',
      message: undefined,
      decision: { choice: 'rest', signal: 'none' },
      nativeResponse: recordedNative,
    });
    await decisionPanel.getByRole('button', { name: 'Game action', exact: true }).click();
    await expect(page.getByLabel('Decision JSON', { exact: true })).toContainText('rest');
    await decisionPanel.getByRole('button', { name: 'Native', exact: true }).click();
    await expect(page.getByLabel('Decision JSON', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Traits and vitals' })).toBeVisible();
    await expect(page.locator('.habitat-caption .signal-legend')).toBeVisible();
    const captionBox = await page.locator('.habitat-caption').boundingBox();
    const rewindBox = await page
      .locator('.habitat-panel input[aria-label="Replay timeline"]')
      .boundingBox();
    if (captionBox.y < rewindBox.y + rewindBox.height)
      throw new Error('Legend must sit below the rewind bar');
    if (captionBox.y + captionBox.height > page.viewportSize().height)
      throw new Error('Legend must fit on screen without scrolling');
    const compactHeight = await decisionPanel.evaluate((el) => el.getBoundingClientRect().height);
    if (compactHeight > 650) throw new Error(`Inspector is too tall: ${compactHeight}`);

    await expect(page.getByLabel('Request elapsed time')).toHaveCount(0);
    const originalPosition = { x: subject.x, y: subject.y };
    const selectionVisible = () =>
      page.locator('canvas').evaluate((canvas) => {
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let selectedPixels = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] === 224 && pixels[i + 1] === 239 && pixels[i + 2] === 159) selectedPixels++;
        }
        return selectedPixels > 20;
      });
    subject.x = 60;
    subject.y = 60;
    await expect.poll(selectionVisible).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const canvas = document.querySelector('canvas');
          const ctx = canvas.getContext('2d');
          const bg = ctx.getImageData(0, 0, 1, 1).data;
          const bottom = ctx.getImageData(
            Math.floor(canvas.width / 2),
            canvas.height - 30,
            1,
            1,
          ).data;
          return [0, 1, 2].some((c) => bg[c] !== bottom[c]);
        }),
      )
      .toBe(true);
    subject.x = originalPosition.x;
    subject.y = originalPosition.y;
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(artifacts, 'rabbit-live-decision.png') });
    await page.getByRole('button', { name: 'Fit habitat' }).click();
    await expect(page.getByRole('button', { name: 'Follow rabbit', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await page.getByRole('button', { name: 'Follow rabbit', exact: true }).click();
    await page.mouse.move(
      subjectCanvas.x + subjectCanvas.width / 2,
      subjectCanvas.y + subjectCanvas.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      subjectCanvas.x + subjectCanvas.width / 2 + 50,
      subjectCanvas.y + subjectCanvas.height / 2 + 10,
      { steps: 4 },
    );
    await page.mouse.up();
    await expect(page.getByRole('button', { name: 'Follow rabbit', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await page.getByRole('button', { name: 'Ⅱ Pause ecosystem' }).click();
    await expect(page.getByLabel('Replay timeline')).toBeEnabled();
    await page.getByRole('button', { name: 'Enter fullscreen' }).click();
    await page.getByRole('button', { name: 'Open run settings' }).click();
    await expect(page.getByRole('dialog', { name: 'Run settings' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close settings' })).toBeInViewport();
    await page.getByRole('button', { name: 'Close settings' }).click();
    await page.getByRole('button', { name: 'Exit fullscreen' }).click();
    // A modal must remain above navigation and fit even with every group expanded.
    const beforeSettingsViewport = page.viewportSize();
    for (const viewport of [
      { width: 2048, height: 967 },
      { width: 1280, height: 720 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      await page.getByRole('button', { name: 'Open run settings' }).click();
      await page.getByLabel('Rabbits settings', { exact: true }).click();
      await page.getByLabel('Wolves settings', { exact: true }).click();
      for (const bottom of [false, true]) {
        await page.locator('.settings-body').evaluate((body, bottom) => {
          body.scrollTop = bottom ? body.scrollHeight : 0;
        }, bottom);
        const layout = await page.locator('.settings-modal').evaluate((dialog) => {
          const rect = dialog.getBoundingClientRect();
          const visible = (selector) => {
            const element = dialog.querySelector(selector);
            const r = element.getBoundingClientRect();
            return (
              r.top >= 0 &&
              r.bottom <= innerHeight &&
              r.left >= 0 &&
              r.right <= innerWidth &&
              element.contains(
                document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2),
              )
            );
          };
          return {
            fits:
              rect.top >= 0 &&
              rect.bottom <= innerHeight &&
              rect.left >= 0 &&
              rect.right <= innerWidth,
            close: visible('.close-modal'),
            title: visible('h2'),
            reset: visible('.settings-footer .primary-button'),
            bodyFits:
              dialog.querySelector('.settings-body').scrollWidth <=
              dialog.querySelector('.settings-body').clientWidth,
            locked: document.body.style.overflow === 'hidden',
          };
        });
        expect(layout).toEqual({
          fits: true,
          close: true,
          title: true,
          reset: true,
          bodyFits: true,
          locked: true,
        });
      }
      await page.getByRole('button', { name: 'Close settings' }).focus();
      await page.keyboard.press('Shift+Tab');
      await expect(page.locator('.settings-footer .primary-button')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Close settings' })).toBeFocused();
      await page.screenshot({
        path: path.join(artifacts, `settings-fit-${viewport.width}x${viewport.height}.png`),
      });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Open run settings' })).toBeFocused();
    }
    await page.setViewportSize(beforeSettingsViewport);
    await page.getByRole('button', { name: 'Analytics', exact: true }).click();
    await expect(page.getByLabel('Replay timeline')).toBeEnabled();
    const analyticsWorld = JSON.stringify(runtime.world);
    await page.getByLabel('Replay timeline').fill('0');
    await expect(page.locator('.rabbit-distributions')).toHaveAttribute('data-time', '0');
    await expect(page.locator('.replay-heading')).toContainText('REPLAY · 0.00s');
    await page.getByLabel('Rabbit distribution metric').selectOption('followRate');
    await expect(page.locator('.dot-histogram .rabbit-dot')).toHaveCount(0);
    await expect(page.locator('.distribution-missing .rabbit-dot')).toHaveCount(80);
    await page.getByLabel('Replay timeline').fill('1');
    await expect(page.locator('.rabbit-distributions')).not.toHaveAttribute('data-time', '0');
    const analyticsFrame = await page.getByLabel('Replay timeline').inputValue();
    await page.getByRole('button', { name: 'Habitat', exact: true }).click();
    await expect(page.getByLabel('Replay timeline')).toHaveValue(analyticsFrame);
    await page.getByRole('button', { name: 'Analytics', exact: true }).click();
    await expect(page.getByLabel('Replay timeline')).toHaveValue(analyticsFrame);
    await page.getByRole('button', { name: 'Return to latest', exact: true }).click();
    await expect(page.locator('.rabbit-distributions')).toHaveAttribute(
      'data-time',
      String(runtime.world.time),
    );
    await page.getByLabel('Rabbit distribution metric').selectOption('followRate');
    await expect(page.locator('.dot-histogram .rabbit-dot')).toHaveCount(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.rabbit-distributions').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(artifacts, 'distributions-mobile.png'),
      fullPage: true,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.setViewportSize(beforeSettingsViewport);
    await page.getByRole('button', { name: 'Habitat', exact: true }).click();
    if (JSON.stringify(runtime.world) !== analyticsWorld)
      throw new Error('Analytics changed the live world');
    const liveTime = runtime.world.time,
      liveState = JSON.stringify(runtime.world);
    await page.getByLabel('Replay timeline').fill('0');
    await expect(page.locator('.replay-heading')).toContainText('REPLAY · 0.00s');
    await expect(decisionPanel).toContainText('RECORDED DECISION');
    await expect(page.getByLabel('Decision JSON', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Close decision panel' }).click();
    await page.getByRole('button', { name: 'Fit habitat' }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(page.getByRole('button', { name: 'Edit map', exact: true })).toBeDisabled();
    await page.getByLabel('Replay timeline').fill('1');
    await expect(page.locator('.replay-heading')).toContainText('REPLAY · 0.05s');
    await page.getByLabel('Replay timeline').fill('0');
    await expect(page.locator('.replay-heading')).toContainText('REPLAY · 0.00s');
    await page.getByLabel('Replay timeline').fill('100');
    await page.waitForTimeout(70);
    await page.getByLabel('Replay timeline').fill('20');
    await expect(page.locator('.replay-heading')).toContainText('REPLAY · 1.00s');
    await page.waitForTimeout(300);
    await expect(page.locator('.replay-heading')).toContainText('REPLAY · 1.00s');
    if (JSON.stringify(runtime.world) !== liveState) throw new Error('Replay changed live world');
    await page.getByRole('button', { name: 'Return to latest' }).click();
    await expect(page.locator('.replay-heading')).toContainText('RUN TIMELINE');
    await page.getByLabel('Replay timeline').fill('1');
    await expect(page.getByRole('button', { name: '▶ Resume latest state' })).toBeVisible();
    await page.getByRole('button', { name: '▶ Resume latest state' }).click();
    await expect(page.getByLabel('Replay timeline')).toBeDisabled();
    if (runtime.world.time !== liveTime) throw new Error('Resume changed recorded state');
    await page.getByRole('button', { name: 'Ⅱ Pause ecosystem' }).click();
    await page.getByRole('button', { name: 'Open run settings' }).click();
    await expect(
      page.getByRole('button', { name: '+ Add rabbit group', includeHidden: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: '+ Add wolf group', includeHidden: true }),
    ).toBeDisabled();
    await expect(page.locator('.species-settings[open]')).toHaveCount(0);
    await expect(page.locator('.species-settings')).toHaveCount(2);
    await expect(page.getByLabel('Group 1 provider', { exact: true })).not.toBeVisible();
    await page.screenshot({ path: path.join(artifacts, 'model-groups-collapsed.png') });
    await page.getByLabel('Rabbits settings', { exact: true }).press('Enter');
    for (let i = 1; i <= 6; i++)
      await expect(page.getByLabel(`Group ${i} provider`, { exact: true })).toBeVisible();
    await page.getByLabel('Rabbits settings', { exact: true }).press('Enter');
    await expect(page.locator('.species-settings[open]')).toHaveCount(0);
    await page.getByLabel('Rabbits settings', { exact: true }).click();
    for (const i of [6, 5, 4]) {
      await page.getByRole('button', { name: `Remove group ${i}` }).click();
    }
    await page.getByLabel('Group 1 provider', { exact: true }).selectOption('anthropic');
    const model1 = page.getByLabel('Group 1 model', { exact: true });
    await expect(model1.locator('option')).toHaveText(['Claude Haiku', 'Claude Sonnet 4.6']);
    await expect(model1).toHaveValue('claude-haiku-4-5-20251001');
    await model1.selectOption({ label: 'Claude Sonnet 4.6' });
    await expect(page.getByLabel('Group 1 provider', { exact: true })).toBeVisible();
    await page.getByLabel('Group 2 provider', { exact: true }).selectOption('openai');
    await expect(page.getByLabel('Group 2 model', { exact: true })).toHaveValue('gpt-5.6-luna');
    await expect(page.getByLabel('Group 2 model', { exact: true }).locator('option')).toHaveText([
      'GPT-5.6 Luna',
    ]);
    await page.getByLabel('Group 3 provider', { exact: true }).selectOption('google');
    await expect(page.getByLabel('Group 3 model', { exact: true })).toHaveValue('gemini-3.8-flash');
    await expect(page.getByLabel('Group 3 model', { exact: true }).locator('option')).toHaveText([
      'Gemini 3.8 Flash',
    ]);
    await expect(page.getByLabel('Group 1 name', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Group 1 model ID', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('dialog')).toContainText('Needs OPENAI_API_KEY');
    await expect(page.getByRole('dialog')).toContainText('Needs GEMINI_API_KEY');
    await page.screenshot({ path: path.join(artifacts, 'model-settings.png') });
    await page.getByRole('button', { name: 'Reset habitat with these settings →' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.locator('.lineage-stat')).toHaveCount(3);
    const reset = controls.find((c) => c.action === 'reset');
    if (reset.groups.length !== 3 || reset.groups[1].provider !== 'openai')
      throw new Error('Bad roster reset');
    if (
      reset.groups.map((g) => g.label).join('|') !==
      'Claude Sonnet 4.6|GPT-5.6 Luna|Gemini 3.8 Flash'
    )
      throw new Error('Model selection did not update group names');
    if (reset.groups[0].model !== 'claude-sonnet-4-6') throw new Error('Incorrect model ID');
    await page.reload();
    await expect(page.locator('.lineage-stat')).toHaveCount(3);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Open run settings' }).click();
    await expect(page.locator('.species-settings[open]')).toHaveCount(0);
    await page.getByLabel('Wolves settings', { exact: true }).click();
    await page.getByRole('button', { name: '+ Add wolf group' }).click();
    await expect(page.getByLabel('Group 4 controller', { exact: true })).toHaveValue(
      'deterministic',
    );
    await expect(page.getByLabel('Group 4 births and deaths', { exact: true })).toHaveValue(
      'dynamic',
    );
    await page.getByLabel('Group 4 births and deaths', { exact: true }).selectOption('fixed');
    await expect(page.getByLabel('Group 4 provider', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Group 4 starting population', { exact: true })).toHaveValue('10');
    await expect(page.getByRole('dialog')).toContainText('No API key needed');
    await page.getByRole('button', { name: '+ Add wolf group' }).click();
    await expect(page.getByLabel('Group 4 starting population', { exact: true })).toHaveValue('5');
    await expect(page.getByLabel('Group 5 starting population', { exact: true })).toHaveValue('5');
    await page.getByLabel('Group 5 starting population', { exact: true }).fill('3');
    await expect(page.getByLabel('Group 4 starting population', { exact: true })).toHaveValue('7');
    await page.getByLabel('Group 5 controller', { exact: true }).selectOption('model');
    await page.getByLabel('Group 5 provider', { exact: true }).selectOption('anthropic');
    await page.getByLabel('Group 5 model', { exact: true }).selectOption('claude-sonnet-4-6');
    await page.getByLabel('Group 5 controller', { exact: true }).selectOption('deterministic');
    await expect(page.getByLabel('Group 5 births and deaths', { exact: true })).toHaveValue(
      'dynamic',
    );
    await expect(page.getByLabel('Group 5 model', { exact: true })).toHaveCount(0);
    await page.getByLabel('Group 5 controller', { exact: true }).selectOption('model');
    await expect(page.getByLabel('Group 5 model', { exact: true })).toHaveValue(
      'claude-sonnet-4-6',
    );
    await page.getByLabel('Rabbits settings', { exact: true }).click();
    await expect(page.locator('.species-settings[open]')).toHaveCount(2);
    await page.getByLabel('Wolves settings', { exact: true }).click();
    await expect(page.getByLabel('Group 5 controller', { exact: true })).not.toBeVisible();
    await expect(page.getByLabel('Group 1 provider', { exact: true })).toBeVisible();
    await page.getByLabel('Wolves settings', { exact: true }).click();
    await page.getByLabel('Rabbits settings', { exact: true }).click();
    await page.getByLabel('Group 5 controller', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(artifacts, 'model-settings-mobile.png') });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    if (overflow) throw new Error('Mobile overflow');
    await page.getByRole('button', { name: 'Reset habitat with these settings →' }).click();
    await expect(page.locator('.lineage-stat')).toHaveCount(5);
    if (runtime.world.wolves.length !== 10 || runtime.world.rabbits.length !== 80)
      throw new Error('Species budgets changed');
    if (runtime.world.groups.filter((g) => g.species === 'wolf').length !== 2)
      throw new Error('Wolf groups not persisted');
    await page.getByRole('button', { name: 'Analytics', exact: true }).click();
    await expect(page.getByText('Rabbits caught', { exact: true })).toHaveCount(2);
    const control = runtime.world.groups.find((g) => g.controller === 'deterministic');
    const aiPack = runtime.world.groups.find(
      (g) => g.species === 'wolf' && g.controller === 'model',
    );
    if (control.wolfLifeCycle !== 'fixed' || aiPack.wolfLifeCycle !== 'dynamic')
      throw new Error('Life cycles did not persist independently of controller');
    const controlLine = page.locator(`polyline[data-group="${control.id}"]`);
    await expect(controlLine).toHaveCSS('stroke', 'rgb(160, 170, 165)');
    await expect(controlLine).toHaveAttribute('stroke-dasharray', '4 3');
    await expect(page.locator(`article[data-group="${control.id}"]`).first()).toContainText(
      'Population (fixed)',
    );
    await expect(page.locator(`article[data-group="${control.id}"]`).first()).not.toContainText(
      'Living / births / deaths',
    );
    await expect(page.locator(`article[data-group="${aiPack.id}"]`).first()).toContainText(
      'Living / births / deaths',
    );
    await expect(page.locator(`article[data-group="${control.id}"]`).first()).toHaveClass(
      'deterministic-group',
    );
    await expect(page.locator(`article[data-group="${aiPack.id}"]`).first()).not.toHaveClass(
      'deterministic-group',
    );
    await page
      .getByLabel('Inspect an animal')
      .selectOption(String(runtime.world.wolves.find((w) => w.lineage === aiPack.id).id));
    await expect(page.locator('.inspect-panel').getByText('Energy', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close inspector' }).click();
    await page
      .getByLabel('Inspect an animal')
      .selectOption(String(runtime.world.wolves.find((w) => w.lineage === control.id).id));
    await expect(
      page.getByText('Births and deaths disabled · wolves are immortal.', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Close inspector' }).click();
    await page.getByRole('button', { name: 'Habitat', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
      .locator('.side-panel')
      .filter({ has: page.getByRole('img', { name: 'Population chart' }) })
      .screenshot({ path: path.join(artifacts, 'wolf-control-chart.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.locator('.lineage-stat')).toHaveCount(5);
    await page.getByRole('button', { name: 'Enter fullscreen' }).click();
    await expect(page.locator('.stats-strip')).toBeInViewport();
    await expect(page.getByLabel('Replay timeline')).toBeInViewport();
    await page.getByRole('img', { name: 'Population chart' }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('img', { name: 'Population chart' })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Exit fullscreen' })).toBeInViewport();
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error('Fullscreen mobile overflow');
    await page.screenshot({ path: path.join(artifacts, 'habitat-fullscreen-mobile.png') });
    await page.getByRole('button', { name: 'Exit fullscreen' }).click();
    await page.locator('.replay-controls').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(artifacts, 'replay-mobile.png') });
    // Map editing is a paused preview, then one atomic server operation.
    const editButton = page.getByRole('button', { name: 'Edit map', exact: true });
    const editorPanel = page.getByRole('region', { name: 'Map editor', exact: true });
    await editButton.click();
    await expect(editorPanel).toBeVisible();
    const editorDialog = page.getByRole('dialog', { name: 'Edit habitat' });
    const mobileCanvas = await page.locator('canvas').boundingBox();
    const mobileTools = await editorPanel.boundingBox();
    if (
      mobileCanvas.height < 400 ||
      mobileTools.height > 230 ||
      mobileCanvas.y + mobileCanvas.height > mobileTools.y + 1
    )
      throw new Error('Mobile editor should keep a large canvas above compact tools');
    await expect(editorDialog).toBeVisible();
    await expect(page.getByLabel('Replay timeline')).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Open run settings', includeHidden: true }),
    ).toBeDisabled();
    await expect(editorPanel.locator('img')).toHaveCount(3);
    await page.waitForFunction(() => {
      const c = document.querySelector('canvas');
      const ctx = c?.getContext('2d');
      if (!ctx || !c.width || !c.height) return false;
      const colors = new Set();
      for (let y = 1; y < 20; y++)
        for (let x = 1; x < 20; x++)
          colors.add(
            [
              ...ctx.getImageData(
                Math.floor((c.width * x) / 20),
                Math.floor((c.height * y) / 20),
                1,
                1,
              ).data,
            ].join(','),
          );
      return colors.size > 10;
    });
    await page.screenshot({ path: path.join(artifacts, 'map-editor-mobile.png') });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error('Map editor mobile overflow');
    await editorPanel.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1100 });
    await editButton.click();
    const unedited = JSON.stringify(runtime.world);
    await editorPanel.getByRole('button', { name: 'Water', exact: true }).click();
    await page.getByLabel('Brush size').selectOption('3');
    const mapCanvas = page.locator('canvas');
    await mapCanvas.focus();
    await mapCanvas.press('Enter');
    await expect(editorPanel.getByRole('status')).toHaveText('9 tiles painted');
    if (JSON.stringify(runtime.world) !== unedited)
      throw new Error('Draft painting changed the live world');
    await editorPanel.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(editorPanel.getByRole('status')).toHaveText('0 tiles painted');
    await editorPanel.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(editorPanel.getByRole('status')).toHaveText('9 tiles painted');
    await editorPanel.getByRole('button', { name: 'Cancel', exact: true }).click();
    if (JSON.stringify(runtime.world) !== unedited)
      throw new Error('Cancel changed the live world');
    await editButton.click();
    await page.getByLabel('Brush size').selectOption('1');
    await editorPanel.getByRole('button', { name: 'Trees', exact: true }).click();
    await expect(page.getByLabel('Brush size')).toHaveValue('3');
    await expect(page.getByLabel('Brush size')).toBeDisabled();
    await mapCanvas.scrollIntoViewIfNeeded();
    const bounds = await mapCanvas.boundingBox();
    const toolsBounds = await editorPanel.boundingBox();
    if (
      bounds.y + bounds.height > 1100 ||
      toolsBounds.x + toolsBounds.width > bounds.x + 1 ||
      toolsBounds.width > 250
    )
      throw new Error('Desktop tools and canvas should fit side by side without scrolling');
    await expect(
      editorPanel.getByRole('button', { name: 'Apply map', exact: true }),
    ).toBeInViewport();
    if (Math.abs(bounds.width - bounds.height) > 4)
      throw new Error(
        'Desktop editing canvas should fit the square map without wide empty gutters',
      );
    const brushFont = await editorPanel
      .locator('.terrain-tool')
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    if (brushFont < 16) throw new Error('Editor brush labels must remain readable');
    const scale = Math.min(bounds.width, bounds.height) / (64 * 16);
    const originX = bounds.x + (bounds.width - 64 * 16 * scale) / 2;
    const originY = bounds.y + (bounds.height - 64 * 16 * scale) / 2;
    const position = (x, y) => ({
      x: originX + (x + 0.5) * 16 * scale,
      y: originY + (y + 0.5) * 16 * scale,
    });
    const a = position(12, 12),
      b = position(16, 12);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up();
    await expect(editorPanel.getByRole('status')).toHaveText('18 tiles painted');
    await editorPanel.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(editorPanel.getByRole('status')).toHaveText('0 tiles painted');
    await editorPanel.getByRole('button', { name: 'Redo', exact: true }).click();
    const frameBeforeMap = runtime.replay.frames - 1;
    await editorPanel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(artifacts, 'map-editor-desktop.png') });
    await editorPanel.getByRole('button', { name: 'Apply map', exact: true }).click();
    await expect(editorPanel).toHaveCount(0);
    if (
      runtime.world.mapRevision !== 1 ||
      !runtime.world.tiles
        .filter((t) => t.x >= 12 && t.x < 18 && t.y >= 12 && t.y < 15)
        .every((t) => t.kind === 'forest')
    )
      throw new Error('Painted trees did not persist');
    await page.reload();
    await expect(page.locator('.map-meta')).toContainText('CUSTOM MAP');
    await page.getByLabel('Replay timeline').fill(String(frameBeforeMap));
    await expect(editButton).toBeDisabled();
    await page.getByRole('button', { name: 'Return to latest' }).click();
    await editButton.click();
    await mapCanvas.focus();
    await mapCanvas.press('Enter');
    running = true;
    await expect(editorPanel.getByRole('alert')).toContainText('live habitat changed');
    await expect(
      editorPanel.getByRole('button', { name: 'Apply map', exact: true }),
    ).toBeDisabled();
    running = false;
    await editorPanel.getByRole('button', { name: 'Cancel', exact: true }).click();
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(
      JSON.stringify({
        passed: true,
        checks: [
          'shared Analytics/Habitat replay with historical per-rabbit data and unchanged live state',
          'individual distributions, exact selection values and missing follow opportunities excluded from zero',
          'six model groups and chart lines',
          'pixel habitat',
          'pause and exact frame stepping',
          'rapid scrubbing race',
          'live world unchanged',
          'resume latest',
          'six group cap',
          'two keyboard-accessible species sections; all models expand together',
          'deterministic and AI wolf controllers',
          'independent wolf life-cycle settings and inspectors',
          'gray dashed deterministic chart lines and readable muted stats',
          'separate rabbit and wolf population budgets',
          'wolf catch statistics and saved group roster',
          'remove/add models',
          'provider-filtered model dropdowns and automatic group names',
          'missing key hints',
          'roster reset and reload',
          'mobile fit',
          'paused map editing, brushes, keyboard and continuous drag painting',
          'undo/redo, cancelled previews, persisted edits and stale/running locks',
          'map editor mobile fit and replay terrain preservation',
          'focused editor keeps canvas, terrain palette, and apply controls in view',
          'Habitat/Analytics/Field notes preserve the live world',
          'large painted terrain with fully visible legends across three desktop viewports',
          'opaque sticky navigation stays above scrolled content',
          'native fullscreen, embedded fallback, and Escape',
          'rabbit selection, camera follow, drag/fit release, real decision JSON and measured response time',
          'replay decision panel does not leak future live responses',
          'no page errors',
        ],
        fixtureOnly: true,
      }),
    );
  } finally {
    await browser.close();
    await app.close();
    runtime.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
