Explore the Bugs in the Box repository (read-only). It is a browser game POC with procedural WebGPU maps.

Goal: give the scene designer the context it needs to propose a new map that fits the project.

Steps:
1. Use `workspace.glob` to see the layout; read the README and build/config files.
2. Find the existing maps (index.html files, WGSL shaders, generators) and list them with a one-line description each (name, medium, look).
3. Find shared conventions the template marks as "(reuse)": global seed / PRNG, scripted fly-through and fixed poses, URL hooks (?pose=, ?flythrough=, ?perf=), perf logging, critic/verification scripts. Say where each one lives or that it does not exist yet.
4. Note any world-size, units, camera or style conventions (colour palettes, fog approach).
5. The `focus` input is the new map idea: point out anything in the repo that is similar to it (to reuse or to avoid duplicating).

Save these outputs with `set_output`:
- `overview` (markdown): sections "Project", "Existing maps", "Reusable pieces", "Conventions", "Related to the new idea". Every fact with its evidence_ref (`path` or `path:line`).
- `main_language`: the main programming language.

Do not guess: when something is not in the files, write "unknown" or "not found".