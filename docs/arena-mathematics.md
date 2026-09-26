# What equations does Evolution Arena implement?

Audit of the simulation on the `codex/wolf-groups-settings` branch, including the pressure changes from PR #12 and food-sharing changes from main commit `60dfd3c` (PR #14). Time is measured in simulation seconds. This document describes existing mechanics; it does not change them or claim that fitted coefficients have been measured.

## Conclusion

This is a spatial, individual-based simulation with discrete births/deaths, resource dynamics, inherited traits, and asynchronous model decisions. It does not integrate a two-population Lotka–Volterra ODE. The exact population accounting is simple, but the event rates cannot be computed from rabbit and wolf counts alone.

The [CMU notes supplied by the user](https://ulissigroup.cheme.cmu.edu/math-methods-chemical-engineering/notes/ordinary_differential_equations/18-nonlinear-coupled-ODEs.html#lotka-volterra-dynamics-predator-prey) describe

\[
\dot R=\alpha R-\beta RW,\qquad \dot W=\delta RW-\gamma W.
\]

That model includes predator reproduction and mortality. The arena now includes both when wolf life cycles are dynamic; fixed-population control groups disable them. Its resource limits, pairwise mating, spatial visibility, cooldowns, age structure and delayed decisions also violate the assumptions needed to identify its dynamics with those constant-coefficient equations. The CMU example's numeric coefficients use days and are not parameters of this code.

## Exact population equations

For rabbit group \(g\), define cumulative successful births \(B_g\), predator deaths \(P_g\), starvation deaths \(S_g\), dehydration deaths \(H_g\), and old-age deaths \(A_g\), all counted from the current reset:

\[
R_g(t)=R_g(0)+B_g(t)-P_g(t)-S_g(t)-H_g(t)-A_g(t).
\]

Equivalently, for an actual engine step,

\[
R_{g,n+1}=R_{g,n}+b_{g,n}-p_{g,n}-s_{g,n}-h_{g,n}-a_{g,n}.
\]

Lowercase quantities are integer events in that step, not constant rate coefficients. Total rabbits are \(R=\sum_gR_g\). For every wolf group \(k\),

\[
W_k(t)=W_k(0)+B^W_k(t)-S^W_k(t)-A^W_k(t)
\]

between resets. The wolf terms are cumulative births, starvation and old-age deaths. In fixed-population mode they are all zero, giving \(W_k(t)=W_k(0)\). Defaults are two rabbit groups of 40 and one dynamic wolf group of 10, so \(R(0)=80\) and \(W(0)=10\). Configured rosters change initial counts. Removing all wolves gives \(W=0\). The rabbit ceiling is 180; wolf births stop at a global ceiling of 32 wolves.

These are exact balance identities, not a closed predictive ODE. Two worlds with the same \((R,W)\) but different energy, food, positions or accepted mating actions can have different next-step populations. Between events the count trajectory is constant; at events it jumps. An ordinary smooth derivative does not describe those jumps (a counting measure does).

Implementation: `core/src/evolution/simulation.ts` (`kill`, `reproduce`, `stepWorld`); `world.ts` (`createWorld`); group counters in `types.ts`.

## Exact resource and individual update rules

Write \(\Delta t\) for one actual substep. Runtime steps are at most 0.05 seconds, using elapsed time; 50 ms is the timer target, not a guarantee of identical step lengths. Rabbit update order is rotated using the seeded RNG. Updates within a step are sequential, not simultaneous.

### Food

For food-capable tile \(j\), capacity \(K_j\) is fixed by seeded food patches. During drought, exposed grass first loses food through withering. Let $I_j=1$ for grass not adjacent to water during drought, otherwise zero. Regrowth then happens before rabbits eat or collect:

\[
\widetilde F_{j,n}=\min\left(K_j,\max(0,F_{j,n}-0.025\Delta t I_j)+\Delta t\frac{K_j}{6}r_n\right),\quad
r_n=\begin{cases}0.0064&\text{drought}\\0.03&\text{otherwise.}\end{cases}
\]

Each rabbit's bite or collection is subtracted immediately, so later rabbits see the remaining food. This is capacity-clipped linear replenishment, not logistic growth \(rF(1-F/K)\). Tiles outside patches have zero capacity. A depleted patch needs 200 seconds to refill normally if ungrazed. During drought, a protected patch would need 937.5 seconds; exposed grass generally loses food because its withering rate exceeds its regrowth rate. Lakes do not deplete.

### Energy, movement and water

For rabbit \(i\), let \(s_i,v_i,q_i,f_i,c_i\) be speed, vigilance, thrift, fertility and sociability genes. First apply basal metabolism, with \(m_i=1\) for both rest and active actions:

\[
\widetilde E_i=E_i-\Delta t\,m_i(0.3+0.06v_i+0.05s_i-0.035q_i).
\]

The movement speed budget is

\[
u_i=(1.05+0.65s_i-0.16q_i)\begin{cases}0.77&\text{starting tile is forest}\\1&\text{otherwise.}\end{cases}
\]

The rabbit follows its current path for distance \(d_i\le u_i\Delta t\); an empty/finished path can make the actual distance smaller. Energy then loses \(d_i(0.1+0.14s_i)\).

After arriving, foraging lasts a 2-second bout before the rabbit returns to rest and must decide again. If the path is finished, the bout has not expired, the action is forage, food is positive and energy is below 100, the bite is

\[
b_i=\min\left(F_j,\;1.4\Delta t(1-0.3q_i),\;\frac{100-E_i}{4}\right).
\]

Here \(E_i\) and \(F_j\) are the values at that exact update point. Apply \(E_i\gets E_i+4b_i\), \(F_j\gets F_j-b_i\).

Water first loses \(\Delta t\,d_n\), where \(d_n=0.15\) normally and **0.22 during drought**. A stationary drinking rabbit adjacent to water then receives \(16\Delta t\), capped at 100. Drought increases water loss and reduces food regrowth.

A transmitted signal, when energy is above 2, independently costs \(0.6(1+c_i)\) energy at decision application. Age increases by \(\Delta t\); mating cooldown decreases by \(\Delta t\). After the rabbit's movement/feeding/drinking/mating update, it dies if energy is at most zero; otherwise if water is at most zero; otherwise if age exceeds 340. That order determines the recorded cause.

### Carried food, caches and sharing (latest main)

Rabbits have inventory $C_i$ capped at 4 food units; each burrow cache has inventory $Q_j$ capped at 32. These start empty. `stepRelief` runs after movement when a rabbit's path has finished, before normal foraging/drinking/mating and the mortality check. Each action has its own condition:

- **Collect:** $x=\min(F_j,1.4\Delta t(1-0.3q_i),4-C_i)$, then $F_j\gets F_j-x$, $C_i\gets C_i+x$. No energy gained yet.
- **Eat cargo:** $x=\min(C_i,\max(0,100-E_i)/4)$, then $C_i\gets C_i-x$, $E_i\gets E_i+4x$. This is a one-time transfer per completed action, not intake limited by $\Delta t$.
- **Share:** when the recipient exists, has energy below 55 and is within 1.5 tiles, $x=\min(C_i,(100-E_k)/4)$. If $x>0.1$, subtract it from the donor's cargo and add $4x$ to the recipient's energy. It does not transfer the donor's own energy. Same-group and cross-group deliveries are allowed. Tracking of the recipient is visibility limited and replans every 0.65 seconds.
- **Deposit:** at a cache within 0.8 tiles, $x=\min(C_i,32-Q_j)$.
- **Withdraw:** at a cache within 0.8 tiles, $x=\min(Q_j,4-C_i)$. Deposit/withdraw occur when $x>0.1$ and conserve food between cargo and cache.

Carried and cached food does not wither; a dead rabbit's cargo disappears with the rabbit. The resulting aggregate energy balance needs intake from the ground, cargo and other rabbits, and the food state must include tiles, inventories and caches. Sharing/caching changes future survival and births but creates no rabbits directly, so the exact population balance above still applies.

A `help` signal is accepted for transmission only below 55 energy, above 2 energy and outside a 6-second help cooldown. It pays the ordinary signal cost. A healthy recipient or empty donor stops a delivery pursuit. An urgent-relief count means a transfer raised energy from below 25 to at least 25; it is not proof of a prevented death. Drought reports track the original rabbit cohort, excluding births. Those counters do not influence physics.

### Births and inheritance

One birth occurs only when `reproduce` succeeds. The executing rabbit has finished its path and both parents must:

- belong to the same group, select each other and have action `mate`;
- be at least 25 seconds old, have no remaining mating cooldown, energy at least 62 and water at least 35;
- be less than 1.7 tiles apart.

The executing parent must have no wolf within 4 tiles. This check uses distance, not line of sight, and is evaluated relative to that parent. There must be fewer than 180 rabbits and a walkable neighboring birth location without a rabbit within 0.5 tiles. Successful reproduction creates exactly one child and immediately resets both parents to rest, preventing the reciprocal check from producing a second child.

Each parent pays \(25+12f_i\) energy and receives cooldown \(25(1.3-0.6f_i)\). A child starts with energy 65, water 80, age zero and a 25-second initial cooldown. Founders start with energy 75, water 90, age 25 and an 8-second cooldown. There are no sexes, gestation or litter sizes.

For every gene,

\[
g_{\rm child}=\operatorname{clip}_{[0.05,0.95]}\left(\frac{g_a+g_b}{2}+0.13(U-0.5)\right),
\]

where \(U\) comes from the seeded generator. Model/controller lineage is inherited unchanged; personal memories are not inherited. Mating is restricted to the same model group, so splitting a population into more groups changes mate availability even if all groups use the same model. The population ceiling is a hard birth gate, not a logistic carrying-capacity term.

### Wolves

Wolf cooldown first becomes \(\max(0,c-\Delta t)\). Speed is 1.55 tiles/second, multiplied by 0.77 on a starting forest tile and by 0.35 during eating cooldown. At each wolf update, its current target is caught if the target still exists, cooldown is zero, distance is below 0.6 and the target is not in a shelter. A catch removes one rabbit and sets cooldown to 18 seconds. Both controllers share these mechanics; their life-cycle choice separately determines whether energy, age, reproduction and mortality are active. Wolves have no water state.

Target/path updates occur on a 0.65-second schedule. Deterministic wolves choose the nearest visible prey or seeded patrol paths. AI wolves select rest, a visible patrol destination or a visible prey using their provider; they do not get automatic target selection. Vision normally extends 10 tiles, reduced to 2 for a hiding forest rabbit. Mountains and sufficiently deep forest block sight; shelters exclude prey. Visibility controls acquisition and replanning; the capture check itself uses target existence, distance, cooldown and shelter status.

The cooldown limits sustained consumption per wolf to at most about \(1/18\) rabbit/second, with travel, search and decisions lowering it further. This is a long-run bound, not an instantaneous cap: several hungry wolves can catch prey in the same frame.

### Exact dynamic wolf life-cycle updates

For wolf $i$, first increment age by $\Delta t$ and reduce reproduction cooldown toward zero. If $d_i$ is distance actually moved and $k_i\in\{0,1\}$ indicates a catch, its pre-birth reserve is

\[
\widetilde E_i=E_i-0.6\Delta t-0.1d_i,\qquad
\widehat E_i=\begin{cases}\min(100,\widetilde E_i+45)&k_i=1\\\widetilde E_i&k_i=0.\end{cases}
\]

Starvation removes it if $\widehat E_i\le0$; otherwise age above 240 seconds removes it. Mortality is checked after movement/capture. Pair reproduction is checked only after all adults have completed those updates. A pair $(i,j)$ produces one pup only when both are still alive, belong to the same group, have age at least 30, reserves at least 95, reproduction cooldown zero, and mutually chosen `mate` actions targeting each other. Their separation must be below 1.7 tiles with terrain visibility, a free adjacent walkable non-shelter birth tile, and fewer than 32 wolves.

On birth, $E_i'=\widehat E_i-50$ and $E_j'=\widehat E_j-50$. Both reproduction cooldowns reset to 45 seconds and their mating actions clear, so the pair contributes exactly one birth. The child records both parent IDs, starts with 35 energy, age zero, no hunting cooldown, and the same group/controller; its generation is $1+\max(g_i,g_j)$. Newborns are not processed again within their birth step. Founders start at age 30, energy 60 and hunting cooldown 8 seconds.

Deterministic wolves prioritize eligible visible mates (preferring reciprocal interest), then use their usual hunting/patrol rules. AI wolves must each select a legal mating action. Both controllers use the same pair eligibility and birth mechanics. A catch without a mate never causes reproduction. The simulation does not model sexes or gestation. The 32-wolf cap is a hard gate, not a logistic carrying capacity. Fixed mode bypasses energy loss, aging, reproduction and mortality; the UI names this separate setting **Births and deaths** to distinguish it from the controller.

## Why model decisions are part of the mathematical state

Rabbit vision is \(4+\lfloor6v_i\rfloor\) tiles with terrain occlusion. The legal choices depend on local resources, same-group mates, threats, memory and moving/signaling neighbors. Signals deliver after 0.2 seconds, expire 6 seconds after emission, have range \(3+5c_i\), and never force recipients to follow. Memory is bounded and sampled at decision time. Following periodically replans while the leader is visible; hiding ends when no wolf is visible.

All rabbit providers receive the same role instructions and observation structure through different API formats. Wolf providers receive a separate wolf role and actions. The engine keeps executing the last accepted action while requests are pending. Replies can be late, cancelled or invalid. Configured artificial delays and equalized timing alter when actions can take effect. Thus food intake, mate coordination, survival and births depend on the entire action/response history.

A faithful mathematical representation is a state transition

\[
X_{n+1}=\Phi_{\Delta t_n}(X_n;U_n,A_n),
\]

plus decision-application events between steps. \(X\) includes animal positions, traits, energy, water, paths, cooldowns, tile resources, carried food, communal caches, signals, memory and runtime state; \(U\) is seeded randomness; \(A\) includes external accepted model outputs and their arrival times. A seed fixes the initial habitat, not live API outputs or response timing. Replay restores recorded states and never reruns the decision process.

## An approximation one could fit, not the implemented equation

The eating cooldown motivates testing a saturating functional response rather than assuming predation is always proportional to \(RW\). A candidate average model is

\[
\dot R\approx b_{\rm eff}(t)R-d_{\rm eff}(t)R-\frac{aRW}{1+18aR},\qquad \dot W\approx\varepsilon_{\rm eff}(t)\frac{aRW}{1+18aR}-\mu_{\rm eff}(t)W.
\]

This candidate assumes all wolf groups have dynamic life cycles; fixed control groups instead retain zero population derivative. The predation term is a Holling type-II form. Predator birth efficiency and mortality must also be fitted: thresholds, reserve history, cooldowns and deterministic age limits are not constant birth/death hazards. The coefficients \(a,b_{\rm eff},d_{\rm eff}\) are **not constants defined or measured in the code**. Here \(R\) is count in the fixed arena, so \(a\) has units of inverse rabbit-seconds (an area convention must be included if using density). The 18-second cooldown supplies a minimum post-catch handling interval; actual effective handling/search time also includes travel and API waiting. Wolves can move during cooldown, further limiting a literal mapping to the standard assumptions.

This is an unvalidated surrogate. It requires measuring births, non-predator deaths and catches over many seeds and prey densities, conditioning on food, water and controller, and checking predictions on held-out runs. The full arena cannot in general be reduced to constant \(b,d,a\). In particular, neither \(\alpha\) nor \(\beta\) can be read off from movement speed or mating cooldown. For fixed-population control groups only, setting the classical predator coefficients \(\delta=\gamma=0\) reproduces fixed wolves but does not make its rabbit equation exact.

Research basis: [Holling (1959), Some Characteristics of Simple Types of Predation and Parasitism](https://doi.org/10.4039/ent91385-7); [Type II functional response for continuous, physiologically structured models](https://www.sciencedirect.com/science/article/abs/pii/S002251930900160X), which explicitly gives the handling-time response \(aN/(1+ahN)\). The use of that form for this arena is an inference to test, not a result established by those sources for this implementation.

## Audit boundary

Reviewed population creation/validation, terrain/food generation, visibility/pathfinding, observation/action rules, physiology, collection/sharing/caches/help signals/rescue reports, mating/mutation, mortality, both wolf controllers, provider adapters, runtime scheduling, drought/reset/stop controls, replay and the UI statistics that report them. Wolf life-cycle changes add food-dependent predator births/deaths; muted chart styling and species-section collapse do not affect physics. Default runs now stop at 600 seconds or 20,000 requests (from PR #15); the run limit is an experiment stop condition, not an ecological death term. Old-age death can occur within the default run: rabbit founders start at age 25 and die above 340; wolf founders start at age 30 and die above 240. After prey extinction, dynamic wolves continue until they die or an experiment limit stops the run. The engine can produce predator–prey feedback but does not guarantee cycles or match the CMU example coefficients.
