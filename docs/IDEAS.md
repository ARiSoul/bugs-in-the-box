# Ideas

Living brainstorm. Nothing here is decided.

## Scenarios (inside devices)

From the initial brainstorm: PCs, phones, power stations, audio interfaces, speakers, guitars, basses, fridges, microwaves, projectors... "so many things". The game's name (*Bugs in the Box*) is generic on purpose: it works for any "box".

How to compose each one from SDF primitives + noise (suggestions):

| Scenario | Terrain | Elements |
|---|---|---|
| Inside a PC (built in Phase 4) | PCB as the base platform, with raised traces | heatsinks (combs of fins), capacitors (cylindrical towers), fans, cables as bridges |
| Speaker | the driver cone as a basin | resonance box, grille, terminals |
| Guitar / bass | the neck as a long bridge | frets as steps, strings as thin obstacles, pickups |
| Fridge | shelves as floors | drawers, fan, food (!) |
| Microwave | turntable plate | light, grille, waves as a hazard |
| Audio interface | panel with giant knobs | potentiometers as towers, VU meters |
| Projector | lens, fan, lamp | light beam as a danger zone |
| Phone / power station | screen as a plain, batteries as pillars | USB ports as tunnels |

## Bugs

Ants, spiders, cockroaches and made-up creatures. Technical idea: one configurable base model (length, number of legs, head size, color) to generate different species without modelling each one by hand.

Special abilities per species (for when each bug gets its proper treatment; to tune later):

- **Spider:** spins webs. A web can trap enemies, or let the spider lower itself safely from a tall drop on a thread instead of falling (no fall damage).
- **Ant:** climbs tall vertical walls, up and down (today every bug only climbs low or thin obstacles: cables, ledges, small parts).
- **Cockroach and others:** to be defined, each with an ability of its own.

Technically these fit the existing data: a species already holds its physics numbers, so an ability would be one more field (for example the ant's climb height), with any new action sent as a turn event like a shot.

## Music-driven mechanics

Use the project's musical DNA: parts of the scenario that pulse to the beat of a track (the speaker cone vibrating, VU meters going up and down, a fan speeding up in the chorus). Each scenario can have its own music and its own hazard rhythms.

## Weapons (original; do not copy Worms ones)

In the game since Phase 2: Solder Blob (impact shell), Capacitor (bouncing, 3 s fuse), Short Circuit (arc that jumps between bugs), Soldering Iron (tunnel). Still ideas: the slow-charging capacitor below, thermal paste, fan.

- **Short circuit:** an electric arc that jumps between nearby bugs.
- **Charged capacitor:** a bomb that builds up charge over several turns before it goes off.
- **Soldering iron:** digs a thin, directional tunnel.
- **Thermal paste:** temporary slippery terrain.
- **Fan:** pushes bugs, changes the wind.

## Names considered

*bugs-in-the-box* (chosen), segfault, kernel-panic, debug-wars, short-circuit, hotfix.
