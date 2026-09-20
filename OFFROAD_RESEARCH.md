# Off-road programmatic AI experiment

## Source and scope

Public context checked September 20, 2026:

- [Hassan Ismail's public LinkedIn activity](https://www.linkedin.com/in/hassanshakerismail) mentions converting a 2026 Ford F-150 Raptor and a Baja RC truck for unmanned operation. The Raptor post describes autonomous operation as upcoming, not a published demonstrated capability.
- [Velocity's August 25, 2026 interview](https://www.velocityincubator.com/news/the-biggest-problem-with-todays-ai-is-handling-what-it-hasnt-seen-before) identifies off-road autonomy, including land and naval vehicles, as a proving ground and mentions construction, mining, logging and defence logistics.
- [Argos's website](https://www.argosresearch.com/) describes a stealth research effort. No exact terrain benchmark, sensor package, simulator or calibrated vehicle model was found in the sources checked.

Accordingly, this repository uses an independently defined generic pickup navigation task. It does not reproduce an Argos operational specification or an exact Ford model. The supplied paper is an architectural proposal rather than a fully specified reproducible algorithm.

## Implemented experiment

The controller reads terrain scan vectors and vehicle state, then directly commands steering and acceleration. It gets a point destination; there is no route, lane-following feature, path planner or collision-avoidance override. Programs use a handcrafted vector/scalar/angle type system. In particular, `argmax` maps a vector to an angular steering value, which supplies a substantial direction-selection bias.

The search combines typed Cartesian genetic programming, connected-subexpression mutation, compatible crossover, elitism and epsilon-lexicase parent selection. A small REINFORCE-trained neural prior uses partial-graph summaries to guide operator and connection choices. This is richer than an operator-frequency prior, but it does not reproduce an undisclosed neural search architecture.

The language loop mines parameterized two-operation vector compositions. Candidate grammars face fresh searches on three separate development terrains at two optimizer seeds. The chosen proposal must improve mean development fitness by more than 0.5 and be used by both winning programs. This narrow proposal class cannot invent new primitive semantics, control flow, recursion or perception.

## Evaluation protocol

- Training: nine terrain instances; seeds derived only from the optimizer seed and training instance index.
- Development: three terrains beginning at seed 1,300,000,000; used only for grammar selection.
- Final evaluation: twelve instances per terrain family, beginning at 1,900,000,000. Earlier 1,700,000,000 diagnostic layouts were retired before the final benchmark.
- Four arms: evolutionary search with/without the neural prior, each with fixed/evolving DSL.
- Optimizer seeds: 0, 7, 42; identical main population, generations and main-search rollout count per arm.
- Extra language-discovery rollouts are counted separately. Main policy selection budgets match; total compute does not. No total-compute advantage is claimed.
- Sensor intervention: freeze each final program and set its clearance vector to all ones, while retaining physical obstacles, terrain and all other inputs.
- Test outcomes never select an individual policy or a DSL proposal. These are a small local benchmark with shared test instances, not independent evidence of broad generalization.

Machine-readable outputs retain actual programs, per-family results, sensor interventions and DSL proposals. Run `npm run offroad:benchmark` to regenerate them.

## Measured reference results

Each row aggregates three optimizer seeds × the same 36 test terrains. These counts are repeated evaluations of one small shared suite, not 108 independently sampled tasks.

| Search                                | Arrivals | Collisions | Arrivals with clearance sensors disabled | Main rollouts | Extra DSL rollouts |
| ------------------------------------- | -------: | ---------: | ---------------------------------------: | ------------: | -----------------: |
| Evolution, fixed DSL                  |   53/108 |         21 |                                    5/108 |        94,122 |                  0 |
| Neural-guided evolution, fixed DSL    |   71/108 |         17 |                                    3/108 |        94,122 |                  0 |
| Evolution, evolving DSL               |   53/108 |         21 |                                    5/108 |        94,122 |             11,340 |
| Neural-guided evolution, evolving DSL |   71/108 |         17 |                                    3/108 |        94,122 |              9,450 |

The shipped seed-42 neural-guided run reaches 7/9 training destinations, with one collision and one timeout. It reaches 21/36 test destinations; removing clearance sensing reduces this to 3/36 and increases test collisions from 10 to 30. Its active program combines goal alignment, roughness and clearance for steering, and goal distance/pitch for acceleration. This supports a concrete claim that the learned controller responds to obstacles. It does not establish reliable autonomy: ten test episodes still collide, three have stability/boundary failures, and two time out.

**No proposed DSL primitive was accepted in any of these runs.** The evolving-DSL arms therefore produce the same final programs as their corresponding fixed-DSL arms, while spending extra compute. There is no measured benefit from this macro-discovery procedure on this benchmark. Neural guidance improves aggregate arrivals in this small comparison, but more seeds, broader tasks and controls for initial sampling bias would be needed for a broad search-efficiency claim.

The result identifies a remaining research problem rather than resolving it: mined local compositions must improve fresh synthesis reliably enough to justify their cost. Enlarging the proposal space, measuring earlier time-to-solution, and learning abstraction-specific proposal probabilities are reasonable follow-up experiments; they are not claimed as implemented here.

## Physical approximation

Terrain is a bilinearly sampled height field. Four wheel-location probes determine approximate body height, pitch and roll. Gravity, drag, local grip and steering rate affect motion. Yaw saturation models a simple grip limit; it is not a tire-slip dynamics model. Vehicle footprint collision, grounding, roll/pitch limits and leaving the test area terminate episodes. These limits are experimental approximations, not certified vehicle envelopes.

The 3D viewport calls the same `observe` and `step` functions as training, with interpolation used only for display. It contains no corrective autopilot. Manual driving and injected rocks are replay interventions and do not update the trained policy.
