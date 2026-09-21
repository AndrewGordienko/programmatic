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

## Measured reference results — support model v2

The September 21 rerun uses `offroad-support-v2`. Original angle-cutoff results and all original training runs are preserved in `output/offroad-v1/`; do not aggregate those with the current results. Changing simulator dynamics changes evolutionary trajectories, so differences are not a controlled policy-learning improvement.

Each row aggregates three optimizer seeds × the same 36 test terrains. These counts are repeated evaluations of one small shared suite, not 108 independently sampled tasks.

| Search                                | Arrivals | Collisions | Arrivals with clearance sensors disabled | Main rollouts | Extra DSL rollouts |
| ------------------------------------- | -------: | ---------: | ---------------------------------------: | ------------: | -----------------: |
| Evolution, fixed DSL                  |   78/108 |         15 |                                    0/108 |        94,122 |                  0 |
| Neural-guided evolution, fixed DSL    |   72/108 |         15 |                                    0/108 |        94,122 |                  0 |
| Evolution, evolving DSL               |   78/108 |         15 |                                    0/108 |        94,122 |              6,930 |
| Neural-guided evolution, evolving DSL |   72/108 |         15 |                                    0/108 |        94,122 |              5,670 |

The current seed-42 neural-guided run reaches 8/9 training destinations and 26/36 test destinations (woodland 9/12, quarry 11/12, ridge 6/12). Removing clearance sensing reduces this to 0/36. Five test episodes collide, three have support/grounding/boundary failures, and two time out. It is still a reactive controller with unreliable speed selection, not reliable autonomy.

**No proposed DSL primitive was accepted in any run.** The evolving-DSL arms still tie their corresponding fixed-DSL arms and spend more compute. Neural guidance does not improve aggregate arrivals in this v2 rerun: 72 versus 78. Neither a library-learning gain nor a universal prior benefit has been demonstrated.

The result identifies a remaining research problem rather than resolving it: mined local compositions must improve fresh synthesis reliably enough to justify their cost. Enlarging the proposal space, measuring earlier time-to-solution, and learning abstraction-specific proposal probabilities are reasonable follow-up experiments; they are not claimed as implemented here.

## Physical approximation

Terrain is a bilinearly sampled height field. Four wheel-location probes determine approximate body height, pitch and roll. Gravity, drag, local grip and steering rate affect motion. Yaw saturation models a simple grip limit; it is not a tire-slip dynamics model. Vehicle footprint collision, grounding, sustained loss of support and leaving the test area terminate episodes. These are experimental approximations, not certified vehicle envelopes.

The old rule stopped the truck immediately when `abs(roll + atan(lateral_acceleration/g)) > 0.66` or `abs(pitch) > 0.72`. Ridge seed 42000 with the original controller terminated at 1.8 s, with 27.8° roll and −11.8° pitch. This was an arbitrary angle cutoff, not a simulated rollover.

V2 projects gravity and outward turning inertia into an orthonormal terrain frame, then checks whether the resultant load intersects outside the wheel support footprint. Model half-track is 1 m, half-wheelbase 1.65 m, and center-of-gravity height 1 m. These are explicit generic assumptions. The lateral static limit follows track width divided by twice center-of-gravity height, the geometric ratio described by [NHTSA](https://www.nhtsa.gov/document/progress-report-development-dynamic-rollover-rating-test). The implementation's combined-terrain projection and 0.4 s persistence rule are our own simulator approximation, not an NHTSA procedure. It does not simulate suspension, body roll inertia, airborne motion or longitudinal acceleration load transfer.

A 45° longitudinal grade no longer automatically counts as rollover, the reported ridge case survives its original stop, and sustained physically unsupported banks still terminate. The UI shows support load and the exact failure reason. This correction does not give the policy a speed planner, obstacle override or hand-coded throttle behavior.

The 3D viewport calls the same `observe` and `step` functions as training, with interpolation used only for display. It contains no corrective autopilot. Manual driving and injected rocks are replay interventions and do not update the trained policy.

## Live unseen synthesis race

Open **Unseen challenge** at `http://localhost:5180/#challenge`. `npm run offroad:freeze` produces the prior weights and accepted DSL from training/development only, with a SHA-256 checksum and simulator version. Neither a final controller nor any saved population is included. The reference artifact has zero accepted macros.

After verifying the artifact, the browser generates one or ten cryptographically sampled terrain seeds in the reserved range 2,100,000,000–2,139,999,999. The entire manifest (including search seeds and budget) is persisted before creating either worker. No terrain is filtered by feasibility or success. Local history prevents seed reuse within that browser. All attempts, failures, interruptions, queued seeds and removal ablations can be exported. This is a local audit, not an externally tamper-proof registry.

Both workers start with empty populations, identical frozen neural weights, the same task/optimizer seed and an exact maximum of 50,000 controller evaluations. They stop independently at the first successful candidate or the cap. The successful program is immediately executed by the Three.js truck using the same simulator functions. The other search continues. No unsuccessful candidate is substituted for a solution. Program text and current operator values come from the actual generated graph; learned calls are highlighted only if present. Removing macros reruns the exact manifest seeds and budget while retaining frozen prior weights.

Equal evaluations are not equal CPU time or FLOPs. Grammar masks renormalize prior probabilities. Search necessarily queries the new environment for fitness; only the prior and DSL are frozen. Deployment is a deterministic replay of the synthesized program, not independent generalization evidence. New layouts use the existing terrain generators; held-out compositional terrain families and scalar-to-control library transfer are not implemented. A learned-language speedup is not claimed. With the current empty library, paired results must tie.
