Goal: produce the final map prompt by filling the template below. Do not change the template's wording, order or constraints; only replace the `{{PLACEHOLDERS}}`.

Call `io.get_inputs` first.

Revisions: if the human asked for changes at the review gate, their feedback and your previous `final_prompt` are in the conversation. Apply exactly what they asked and keep the rest. If they ask to change a SCENE value, change it in the prompt and list it in `fill_report` as "changed at review" with evidence_ref `human feedback`. If they ask to change the template's wording or add a section, do it only because they asked, and list the change in `fill_report`.

Mapping:
- From `scene` (json): MAP_PITCH, MAP_NAME, SCENARIO_ID, MEDIUM, DEPTH_GRADIENT, LIGHT_FX, BOUNDARY_SURFACE, HERO_VEGETATION, TERRAIN, GROUND_AND_FLORA, LIFE, SET_PIECES, WORLD_BOUNDS, START_AREA, BOUNDARY_RULE.
- From `reference_notes`: REFERENCES. One list item per file: exact file name, what to take from it, what to ignore, SCENE fields it guides; keep "not seen, described by the human" where it applies. If the input is missing or empty, write "None provided." and do not list it as missing.
- From the inputs: PRIORITIES=`priorities`, TARGET_OS=`target_os`, TARGET_BROWSER=`target_browser`, TARGET_GPU=`target_gpu`, TARGET_CPU=`target_cpu`, TARGET_HZ=`target_hz` followed by "Hz", TARGET_RES=`target_res`, GPU_AVG_MS=`gpu_avg_ms`, FRAME_MAX_MS=`frame_max_ms`, FLYTHROUGH_SECONDS=`flythrough_seconds`, CONTROLS=`controls`, POSE_COUNT=`pose_count`, POSE_RES=`pose_res`, RECORDING_SECONDS=`recording_seconds`, CRITIC_PASS_LEVEL=`critic_pass_level`.

Rules:
- Every placeholder must be replaced; if a value is missing, empty or `TBD`, write `[MISSING: NAME]` in its place and list it in `fill_report` (REFERENCES is the exception above). Do not invent values.
- If a value still says "TODO" (e.g. target GPU/CPU), keep it as it is and flag it in `fill_report`.
- Keep markdown lists (PRIORITIES, REFERENCES, CONTROLS) as lists, indented under their heading.

TEMPLATE (between the lines):
---
Build a real-time {{MAP_PITCH}} as a new scenario of the Bugs in the Box game in this repository. It must look beautiful, let me fly a free camera through it, and work as a playable map.

PRIORITIES (in this order when they conflict)
{{PRIORITIES}}

CONSTRAINTS
- Use three.js, in the version the repository already uses. No other engine and no new runtime dependency without approval.
- WebGPU by default: three.js WebGPURenderer with TSL, on the existing GPU stage. The map's look is designed and judged on WebGPU; it must still load on three's automatic WebGL2 fallback, but do not aim for visual parity there. Do not add a separate WebGL path.
- Not a standalone page: do not create a new index.html. The map opens in the existing app with ?scenario={{SCENARIO_ID}}&seed=<n>, using the existing query parameters.
- Follow CLAUDE.md and docs/ARCHITECTURE.md. Generation is a TerrainGenerator in src/terrain/generators/, registered in src/terrain/scenarios.ts, with no three.js or DOM imports in src/terrain/ or src/game/. Drawn parts go in src/render/gpu/ and camera views in src/debug/views.ts. Study an existing scenario first (e.g. desk.ts with deskParts.ts and its test).
- Terrain stays destructible and collisions use the density field. Drawn parts and their hidden collider bodies agree: what a bug can reach is solid, and bugs stand on what is drawn.
- Everything procedural: no texture/model files. Report the bundle size change (minified, before and after).
- Zero per-frame JS allocations in the code you add (no GC stutter). Preallocate all buffers.
- (reuse) Deterministic: one global seed drives all generation, and the same seed always gives the same map; the camera fly-through and the fixed poses are fully scripted and reproducible.
- Do not change the look or behaviour of the existing scenarios.

TARGET
- {{TARGET_OS}}, {{TARGET_BROWSER}}, {{TARGET_GPU}}, {{TARGET_CPU}}, {{TARGET_HZ}} monitor
- {{TARGET_RES}} at full resolution (no resolution scaling). GPU frame time <= {{GPU_AVG_MS}} ms average, no frame > {{FRAME_MAX_MS}} ms during a scripted {{FLYTHROUGH_SECONDS}} s fly-through.

SCENE: {{MAP_NAME}}
- Medium: {{MEDIUM}}. Strong depth fog/absorption: {{DEPTH_GRADIENT}}.
- Global light: {{LIGHT_FX}}. Boundary surface: {{BOUNDARY_SURFACE}}.
- Hero element: {{HERO_VEGETATION}}
- Terrain: {{TERRAIN}}
- Ground and flora: {{GROUND_AND_FLORA}}
- Animated life: {{LIFE}}
- Set pieces: {{SET_PIECES}}
- World: {{WORLD_BOUNDS}}. Start area: {{START_AREA}}. {{BOUNDARY_RULE}}.

REFERENCES (the files are supplied with this prompt; visual guidance only, never embed or load them as assets; where they conflict with SCENE, SCENE wins)
{{REFERENCES}}

CONTROLS (free-fly camera; reuse the existing ?fly=1 mode, and do not change the gameplay controls)
{{CONTROLS}}

VERIFICATION
- Visual critic: a separate subagent that sees ONLY your renders and the REFERENCES (files and notes), never your code or reasoning. Give it {{POSE_COUNT}} fixed camera poses, rendered at {{POSE_RES}}, plus a short recording ({{RECORDING_SECONDS}} s) of the fly-through to catch shimmer, aliasing, popping and banding. If there are references, it also compares the renders with them. It returns prioritized, concrete defects (severity scale: blocker > major > minor). Iterate until it reports nothing above "{{CRITIC_PASS_LEVEL}}".
- Performance: GPU timestamp queries (on the WebGPU backend, not the fallback) plus a frame-time log from the scripted fly-through. Report average, 99th percentile and max.
- (reuse) Use the existing URL hooks, extended for this scenario where needed, so both gates are repeatable with ?scenario={{SCENARIO_ID}}&seed=<n>: &pose=1..{{POSE_COUNT}} (freeze on a fixed pose), &flythrough=1 (scripted path), &perf=1 (log timestamps and frame times, export JSON), &res=<width>x<height>. Use one fixed seed for both gates and report it; also check that the map holds up with at least two other seeds.
- Repository checks: add tests for the scenario; npm run typecheck, npm run test (mesh integrity included) and npm run build pass, and npm run bench shows no regression against the reference numbers in CLAUDE.md.
- Honesty: state on which hardware and browser the numbers were actually measured. If that is not the target above, label the result as unverified for the target and do not claim the gate passed.

DONE WHEN: the visual and performance gates and the repository checks pass. Deliver the list of changed files, the scenario URL, the bundle size change, the perf report and the critic's final review.
---

Outputs (with `io.set_output`):
- `final_prompt` (markdown): only the filled template, nothing before or after it.
- `fill_report` (markdown): table | Placeholder | Value (short) | evidence_ref (`scene.<KEY>`, `reference_notes`, `input.<name>` or `human feedback`) |, then a list of missing/TODO values, changes made at review, and anything that reads awkwardly after filling (e.g. duplicated punctuation).