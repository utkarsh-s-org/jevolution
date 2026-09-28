import type { ReactNode } from 'react';

import {
  GENE_NAMES,
  GRID,
  MAX_POPULATION,
  RULES,
  TRAIT_INFO,
} from '../../../core/src/evolution/constants.js';

function Formula({ children, legend }: { children: ReactNode; legend: [string, string][] }) {
  return (
    <div className="guide-formula">
      <div className="guide-equation">{children}</div>
      <dl className="guide-legend" aria-label="Equation variable legend">
        {legend.map(([symbol, meaning]) => (
          <div key={symbol}>
            <dt>{symbol}</dt>
            <dd>{meaning}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
const topics = [
  ['guide-world', 'The ecosystem'],
  ['guide-population', 'Population equations'],
  ['guide-food', 'Food & drought'],
  ['guide-evolution', 'Inheritance & learning'],
  ['guide-signals', 'Communication'],
  ['guide-evidence', 'Reading the results'],
] as const;
export function FieldGuide({ onReturn }: { onReturn: () => void }) {
  return (
    <section className="field-guide-view" aria-label="Field guide">
      <div className="view-heading">
        <div>
          <div className="eyebrow">THE SCIENCE BEHIND THE HABITAT</div>
          <h1>Field guide</h1>
          <p>
            What the engine implements, what the equations mean, and what the results can tell us.
          </p>
        </div>
        <button className="secondary-button" onClick={onReturn}>
          Back to habitat →
        </button>
      </div>
      <nav className="guide-contents" aria-label="Field guide topics">
        {topics.map(([id, label], index) => (
          <a href={`#${id}`} key={id}>
            0{index + 1} / {label}
          </a>
        ))}
      </nav>
      <section className="side-panel guide-section" id="guide-world">
        <div className="eyebrow">01 / IMPLEMENTED MECHANICS</div>
        <h2>Selection needs consequences.</h2>
        <p>
          A {GRID} × {GRID} spatial ecosystem. Each animal has a position, resources, age and a
          current action. Rabbits forage, drink, evade predators and choose mates. Wolves hunt and,
          when births and deaths are enabled, must eat to survive and reproduce.
        </p>
        <div className="guide-cards">
          <article>
            <h3>Local information</h3>
            <p>
              Terrain limits movement and sight. Water blocks movement; shores provide drinking
              water. Forest slows movement and obscures sight. Burrows protect rabbits from attacks
              and hold communal food caches.
            </p>
          </article>
          <article>
            <h3>Two choices, independently</h3>
            <p>
              A wolf’s controller can be deterministic or an AI model. Its life cycle can be dynamic
              or fixed. Dynamic wolves can starve, age and reproduce under either controller. Fixed
              wolves do not lose energy, age, give birth or die.
            </p>
          </article>
          <article>
            <h3>Pairs, not instant cloning</h3>
            <p>
              Rabbit and dynamic-wolf parents must be eligible, nearby, in the same group and
              mutually choose to mate. Both pay energy and receive a cooldown. Each successful pair
              produces one child. Sexes and gestation are not modeled.
            </p>
          </article>
          <article>
            <h3>Real-time decisions</h3>
            <p>
              The world continues while model calls are pending. The last accepted action continues;
              late or invalid replies do not replace it. Equal timing holds timely responses to a
              shared response slot. It does not remove every difference between models.
            </p>
          </article>
        </div>
        <p className="small-note">
          The habitat seed controls initialization and seeded randomness. Live API choices and
          arrival times are not fixed by the seed. Replay reads recorded states; it does not rerun
          the models.
        </p>
      </section>
      <section className="side-panel guide-section" id="guide-population">
        <div className="eyebrow">02 / EXACT ACCOUNTING</div>
        <h2>Births add animals. Deaths remove them.</h2>
        <p>
          These balance equations hold for each group between resets. Counts change through
          individual events. They describe the engine exactly, but do not predict those events from
          population size alone.
        </p>
        <Formula
          legend={[
            ['n, n + 1', 'The start and end of one simulation step.'],
            ['Rₙ, Wₙ', 'Living rabbits or wolves in the group at the start of the step (animals).'],
            ['Bᴿₙ, Bᵂₙ', 'Successful rabbit or wolf births during this step (animals).'],
            ['Pₙ', 'Rabbits killed by wolves during this step (animals).'],
            ['Dᴿₙ', 'Rabbit deaths from starvation, dehydration or old age during this step.'],
            ['Dᵂₙ', 'Wolf deaths from starvation or old age during this step.'],
          ]}
        >
          <div>Rₙ₊₁ = Rₙ + Bᴿₙ − Pₙ − Dᴿₙ</div>
          <div>Wₙ₊₁ = Wₙ + Bᵂₙ − Dᵂₙ</div>
        </Formula>
        <p>
          Fixed wolf groups have zero births and deaths, so their count stays constant. Births stop
          at global caps of {MAX_POPULATION} rabbits and {RULES.wolfPopulationCap} wolves. These are
          hard limits, not fitted ecological carrying capacities.
        </p>
        <details className="guide-details">
          <summary>How this relates to the classic predator–prey model</summary>
          <p>
            The classic Lotka–Volterra model uses continuous rates and assumes predation
            proportional to both populations. It is a conceptual comparison here, not the equation
            integrated by the arena.
          </p>
          <Formula
            legend={[
              ['t', 'Continuous time; choose one consistent unit, such as seconds.'],
              ['R(t), W(t)', 'Rabbit and wolf population sizes.'],
              ['dR/dt, dW/dt', 'Population change per unit time.'],
              ['α', 'Rabbit per-capita growth rate (1 / time).'],
              ['β', 'Predation coefficient (1 / wolf / time).'],
              ['δ', 'Predator growth coefficient (1 / rabbit / time).'],
              ['γ', 'Wolf per-capita mortality rate (1 / time).'],
            ]}
          >
            <div>dR/dt = αR − βRW</div>
            <div>dW/dt = δRW − γW</div>
          </Formula>
          <p>
            No values for α, β, δ or γ have been fitted here. Our births require pairs and energy;
            predation depends on terrain, distance, decisions and a {RULES.wolfEatCooldown}-second
            post-catch cooldown. Two worlds with the same counts can evolve differently. Population
            cycles, stable coexistence and extinction are possible outcomes to investigate, not
            promised results.
          </p>
          <p>
            <a
              href="https://ulissigroup.cheme.cmu.edu/math-methods-chemical-engineering/notes/ordinary_differential_equations/18-nonlinear-coupled-ODEs.html#lotka-volterra-dynamics-predator-prey"
              target="_blank"
              rel="noreferrer"
            >
              Source: CMU predator–prey lecture notes ↗
            </a>
          </p>
        </details>
      </section>
      <section className="side-panel guide-section" id="guide-food">
        <div className="eyebrow">03 / EXACT RESOURCE UPDATE</div>
        <h2>Food is finite. Sharing moves it.</h2>
        <p>
          Food-capable tiles replenish before animals eat or collect. Exposed grass withers during
          drought. This is capped linear replenishment, not logistic growth.
        </p>
        <Formula
          legend={[
            ['Fⱼ', 'Food on tile j before replenishment (food units).'],
            ['F̃ⱼ', 'Food after withering and replenishment, before rabbits eat or collect.'],
            [
              'Kⱼ',
              `Tile capacity (food units); ${RULES.foodCapacity} is the reference capacity. Zero-capacity ground produces no food.`,
            ],
            ['Δt', 'Duration of this engine step (simulation seconds).'],
            ['Iⱼ', '1 for exposed grass away from water during drought; otherwise 0.'],
            [
              'ρ',
              `${RULES.foodRegrowth} normally; ${RULES.droughtRegrowth} during drought (food units / second at reference capacity).`,
            ],
            [
              'min, max',
              'Take the smaller or larger value, keeping food within its permitted bounds.',
            ],
          ]}
        >
          <div>
            F̃ⱼ = min(Kⱼ, max(0, Fⱼ − {RULES.droughtWither} Δt Iⱼ) + Δt (Kⱼ / {RULES.foodCapacity})
            ρ)
          </div>
        </Formula>
        <p>
          After this update, bites and collected food are subtracted immediately. Carried food is
          capped at {RULES.cargoCapacity} units per rabbit; caches hold {RULES.cacheCapacity}. Each
          eaten or delivered unit restores {RULES.foodEnergy} energy, up to the recipient’s energy
          limit. Sharing transfers food already collected; it does not create food. Stored and
          carried food does not wither.
        </p>
      </section>
      <section className="side-panel guide-section" id="guide-evolution">
        <div className="eyebrow">04 / EXACT INHERITANCE RULE</div>
        <h2>Traits evolve. Model weights stay fixed.</h2>
        <Formula
          legend={[
            [
              'gchild',
              'One trait value in the newborn rabbit; the rule is applied separately to all five genes.',
            ],
            [
              'gparent1, gparent2',
              'The same trait in each parent (dimensionless, shown as 0–100 in Analytics).',
            ],
            ['ε', `A seeded uniform mutation in [−${RULES.mutation}, +${RULES.mutation}).`],
            ['clip₀.₀₅,₀.₉₅', 'Clamp the child’s trait into the interval 0.05–0.95.'],
          ]}
        >
          <div>gchild = clip₀.₀₅,₀.₉₅((gparent1 + gparent2) / 2 + ε)</div>
        </Formula>
        <div className="guide-table-wrap">
          <table>
            <caption>Inherited rabbit traits and their tradeoffs</caption>
            <thead>
              <tr>
                <th>Trait</th>
                <th>Benefit</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {GENE_NAMES.map((gene) => (
                <tr key={gene}>
                  <th>{TRAIT_INFO[gene].label}</th>
                  <td>{TRAIT_INFO[gene].benefit}</td>
                  <td>{TRAIT_INFO[gene].cost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Survival and successful reproduction change which traits and model lineages remain.
          Offspring inherit their parents’ model group and start without their parents’ memories.
          Wolves currently have fixed physical traits; they do not use this rabbit gene mutation
          rule.
        </p>
        <details className="guide-details">
          <summary>Is this evolutionary reinforcement learning?</summary>
          <p>
            The arena does not train a policy, update model weights, or optimize a reward with
            policy gradients. Existing models choose actions from observations. Inheritance and
            selection operate on simulated rabbit traits and lineage counts.
          </p>
          <p>
            <a href="https://arxiv.org/html/2503.19037v3#S4" target="_blank" rel="noreferrer">
              Evolutionary Policy Optimization (EPO) ↗
            </a>{' '}
            combines evolutionary search over latent agent representations with actor–critic
            training and a master policy that learns from population experience. That is related
            research, not an algorithm implemented here.
          </p>
        </details>
      </section>
      <section className="side-panel guide-section" id="guide-signals">
        <div className="eyebrow">05 / OPTIONAL, LOCAL COMMUNICATION</div>
        <h2>A signal offers information, not an order.</h2>
        <p>
          Equations below describe baseline settings. Active experiment controls override range,
          delay, cost, loss, food growth, predator pressure, and mutation. Temperature is an
          illustrative model, not calibrated biology. Export a run to inspect its effective
          settings.
        </p>
        <div className="guide-signal-list">
          <span>
            <b>!</b> Danger
          </span>
          <span>
            <b>+</b> Food here
          </span>
          <span>
            <b>&gt;</b> Follow me
          </span>
          <span>
            <b>?</b> Need food
          </span>
        </div>
        <p>
          Signals refer to the sender’s position at emission, become available after{' '}
          {RULES.signalDelay} seconds and expire {RULES.signalLife} seconds after delivery. Either
          rabbit group can hear them within range. Seeing a message does not force any action; a
          model may follow, flee, forage or choose something else. Signals can be stale or wrong.
        </p>
        <Formula
          legend={[
            ['cᵢ', 'Rabbit i’s inherited sociability gene (dimensionless, 0–1).'],
            ['Lᵢ', 'Signal radius at emission (tiles).'],
            ['Cᵢ', 'Energy charged to the sender for one transmitted signal.'],
          ]}
        >
          <div>Lᵢ = 3 + 5cᵢ</div>
          <div>Cᵢ = {RULES.signalCost}(1 + cᵢ)</div>
        </Formula>
        <p>
          Rabbits can track visible neighbors and voluntarily share carried food, including across
          groups. A help request is available when energy is below {RULES.hungryEnergy}; it has its
          own cooldown. Wolves currently do not signal.
        </p>
        <p>
          Memory contains each rabbit’s own bounded sightings of food, water and wolves. It is
          neither automatically shared nor inherited. A coordinated sequence can emerge from
          choices, but follow and share are already supplied actions, not newly invented tools or a
          learned communication language.
        </p>
      </section>
      <section className="side-panel guide-section" id="guide-evidence">
        <div className="eyebrow">06 / EVIDENCE, NOT A PREDETERMINED WINNER</div>
        <h2>What makes a convincing experiment?</h2>
        <div className="guide-cards">
          <article>
            <h3>Look beyond the mean</h3>
            <p>
              Analytics plots individual living rabbits. Rewind to compare distributions,
              generations and outcomes. A shift can come from deaths, births or mutation; it is not
              by itself evidence that the model learned.
            </p>
          </article>
          <article>
            <h3>Separate opportunity from response</h3>
            <p>
              Follow rate is follow choices divided by accepted decisions with a follow option. No
              opportunities means no estimate. It does not prove a signal caused the choice or that
              following helped survival.
            </p>
          </article>
          <article>
            <h3>Measure help carefully</h3>
            <p>
              Food deliveries and urgent hunger relief are observed transfers. An urgent-relief
              count means energy crossed the configured threshold; it does not prove a death was
              prevented. Drought survival uses the original cohort, excluding births.
            </p>
          </article>
          <article>
            <h3>Repeat and control</h3>
            <p>
              Compare matched settings over multiple seeds. Report initial groups, food, wolf life
              cycles, timing mode and run limits. Compare communication enabled versus disabled only
              through an explicitly controlled experiment; this UI currently has no global
              communication-off switch.
            </p>
          </article>
        </div>
        <p>
          API latency measures a request round trip, not a model’s full reasoning process. JSON
          shows structured action choices with a separate application status. Survival advantages,
          cooperation benefits and population cycles need measured results; one attractive run is
          not proof of general model superiority or real-world ecological validity.
        </p>
        <button className="primary-button" onClick={onReturn}>
          Return to habitat →
        </button>
      </section>
    </section>
  );
}
