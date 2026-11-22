Goal: turn a short map idea into concrete values for the SCENE fields of the Bugs in the Box map template, so a coding agent can build a beautiful, procedural, WebGPU real-time map from them.

Call `io.get_inputs` first. Inputs: `map_idea`, optional `scene_notes`, `priorities`, `repo_overview` (from repo_context). If the human rejected an earlier proposal, their feedback is in the conversation: apply it and change only what they asked.

Fields to fill (all strings, written in English, one or two dense sentences each, concrete and visual — shapes, colours, scales in metres, motion):
- MAP_PITCH: what the map is, as it fits the sentence "Build a real-time {MAP_PITCH} that runs in the browser" (e.g. "underwater kelp forest").
- MAP_NAME: short evocative name.
- MEDIUM: what fills the space (air, water, haze, spores...).
- DEPTH_GRADIENT: how fog/absorption changes colour and density with distance and depth.
- LIGHT_FX: the global light and its effects (caustics, god rays, bioluminescence...).
- BOUNDARY_SURFACE: the surface that closes the world (water surface, sky dome, glass wall...).
- HERO_VEGETATION: the hero element, the thing the eye goes to.
- TERRAIN: terrain shape and materials.
- GROUND_AND_FLORA: ground cover and small flora.
- LIFE: animated life (bugs, fish, particles) with counts and behaviour.
- SET_PIECES: 2–4 distinct landmarks for the fixed camera poses.
- WORLD_BOUNDS: size of the world in metres.
- START_AREA: where the camera starts and what it sees.
- BOUNDARY_RULE: what happens at the world edge (e.g. "The camera is softly clamped inside the bounds").

Rules:
- Everything must be possible procedurally (no textures/models) and realistic within the GPU budget; respect `priorities` and `scene_notes`.
- Fit the project: reuse conventions and avoid duplicating existing maps found in `repo_overview`.
- Every choice has evidence: in `scene_review`, give each field a short rationale with an evidence_ref (`map_idea`, `scene_notes`, `priorities`, or a `path` from `repo_overview`). Do not invent repo facts; if something is unknown, say so.

Outputs (with `io.set_output`):
- `scene` (json): the object with exactly the 14 keys above.
- `scene_review` (markdown): a table | Field | Value | Rationale | evidence_ref |, then a short "Risks / open questions" list (performance risks, things the human should decide).