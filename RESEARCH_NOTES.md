# What this attempt actually tells us

The primary application is now off-road destination navigation. See [OFFROAD_RESEARCH.md](OFFROAD_RESEARCH.md) for the implemented terrain physics, typed program search, language-discovery protocol and measured four-arm benchmark. The earlier road and scalar results below are retained as baseline history. The off-road benchmark demonstrates an effect of learned obstacle sensing, but finds no accepted DSL abstractions and no improvement from DSL evolution.

Hassan's specific clarification was: “evolution loops that produce sensical DSLs for tasks,” followed by “it's a hard search problem over the dsl.” That points to language design and adaptation as an explicit research bottleneck. It does not reveal their precise representation, search algorithm, task data, or deployment requirements. SDNs and MTR were mentioned as domains; their precise scope remains unspecified here.

## Driving is now the primary application

The first concrete milestone is an evolved executable program controlling steering, throttle and brake in a continuous driving simulator. That milestone is implemented in `src/driving/` and is the default localhost view. Training and the 3D view execute identical vehicle dynamics. Seed 42 improves from 4/8 to 7/8 training roads completed; unseen results are 8/8 sweeping roads, 3/8 tight turns and 2/8 obstacle courses. The winner ignores obstacle sensing, so its failure is explainable by inspecting its code.

This is vehicle-control program synthesis over engineered state observations. In particular, the lookahead-heading input provides substantial route-following structure. It is not learned vision or route planning, and it does not recreate Argos's undisclosed algorithm.

DSL proposals are now tested with vehicle rollouts too. Two proposals are rejected in the default run: although the modified grammar searches find better development controllers, those controllers do not use the proposed macros. Merely changing the operator set changes random sampling and can create an apparent benefit unrelated to using an abstraction. Requiring actual use catches that specific attribution failure; multiple paired search seeds and broader development tasks would still be needed to establish a reliable benefit.

## The distinction worth making on the call

The navigation experiment chooses a language containing goal progress, visit counts, momentum, and clearance, then searches for a scoring function. Legal actions, observation processing, memory, and action selection are supplied. A robot reaching the goal therefore says little about whether the system can discover a useful language. It is a baseline and an inspectable demonstration of program search.

The DSL experiment adds one outer loop: mine parameterized compositions from successful programs, evaluate modified grammars with fresh searches, and select abstractions using separate development tasks. Its limited claim is that even this small grammar-selection problem has measurable failure modes.

## Results from the implementation

Every final trial gets 669 candidate evaluations per language. There are three held-out scalar task variants, with three optimizer seeds each. The outer search runs twice. Test tasks do not participate in grammar selection.

| Outer seed | Fixed DSL solves | Evolved DSL solves | Accepted abstractions         | Extra discovery evaluations |
| ---------- | ---------------: | -----------------: | ----------------------------- | --------------------------: |
| 0          |              4/9 |                4/9 | None                          |                      59,256 |
| 1          |              7/9 |                6/9 | Clamp; positive part          |                      55,242 |
| 2          |              5/9 |                7/9 | Absolute value; positive part |                      59,256 |
| 3          |              5/9 |                7/9 | Absolute value; positive part |                      59,256 |
| 42         |              5/9 |                7/9 | Positive part                 |                      59,256 |

The names above describe the semantics after discovery. The engine generates names such as `fn_1`, and mines the expression bodies from synthesized solutions; these named abstractions are not inserted into the initial grammar.

Seed 42 is especially illustrative. Adding `max(x, 0)` improves bounded-sum synthesis from 0/3 to 3/3 but reduces positive-sum synthesis from 3/3 to 2/3. A composition can be useful while making a particular search less likely to succeed. The added operator changes the sampling distribution and branching factor.

Seed 1 is the stronger warning: a grammar selected for improving development-task performance performs worse on the final task suite. Grammar selection can overfit the task distribution and optimizer seeds just as program selection can overfit examples.

These are small synthetic benchmarks. The aggregate 31/45 versus 26/45 is not a significance claim, and there is no compute break-even claim: discovery is expensive relative to the final searches.

## The problems still exposed by this prototype

- **Bootstrapping:** macro mining only considers successful programs. If the original language and search cannot solve useful tasks, there may be no useful fragments to mine.
- **Proposal bias:** only existing scalar expressions can become macros. Inventing new semantics, types, control structures, or perceptual primitives is outside this search space.
- **Evaluation cost:** measuring a DSL requires running another search. Selecting it from a few noisy inner runs is cheap but unreliable; evaluating many tasks and seeds costs much more.
- **Representation versus search:** compression is insufficient. A new primitive changes the grammar's proposal distribution. This experiment uses uniform operator sampling; a language-aware learned search prior is an unimplemented next comparison.
- **Credit assignment:** a useful library member may help only in combination with another primitive or on harder future tasks. Single-macro proposals can miss this.
- **Generalization:** the final tasks are deliberately related scalar transformations. This does not establish usefulness on routing, perception, control, or other actual workloads.

## Concrete follow-up experiments

1. Repeat the grammar comparison with a learned proposal distribution, holding the language fixed, to separate grammar quality from sampler quality.
2. Evaluate multi-primitive proposals and deletion of unhelpful primitives instead of add-only, one-at-a-time selection.
3. Track total primitive executions and time-to-solution, including discovery cost, across progressively larger future task batches.
4. Replace the designed scalar family with one of their actual task distributions and allowed primitive sets. That is the critical missing input before claiming relevance to their bottleneck.

The useful question for Hassan is whether his DSL search primarily concerns reusable abstractions over known primitives, new primitive semantics, language typing/control structure, or joint evolution of all of these. This implementation addresses only the first.

# Current focus: useful library learning

The default dashboard now measures future synthesis effort with a frozen scalar library and prior. See [LIBRARY_RESEARCH.md](LIBRARY_RESEARCH.md) for the 800-task protocol, 20-seed negative result, and limited outer value-model probe. None of the 20 runs accepted a library edit; prior-only gains do not demonstrate DSL learning. The notes below document earlier baselines.
