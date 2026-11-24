# Ideas

Living brainstorm. Nothing here is decided.

## Scenarios (inside devices)

From the initial brainstorm: PCs, phones, power stations, audio interfaces, speakers, guitars, basses, fridges, microwaves, projectors... "so many things". The game's name (*Bugs in the Box*) is generic on purpose: it works for any "box".

How to compose each one from SDF primitives + noise (suggestions):

| Scenario | Terrain | Elements |
|---|---|---|
| Inside a PC (built in Phase 4 as Tower Case) | PCB as the base platform, with raised traces | heatsinks (combs of fins), capacitors (cylindrical towers), fans, cables as bridges |
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
- **Ant:** to be defined (climbing walls is now every bug's: they all crawl on any surface).
- **Cockroach, Hard Shell (in the game):** the first blow that would kill it leaves it at 1 health, once a match, and cracks its shell. Leaving the map still kills it.
- **Cockroach, Glide:** it opens its wings in the air and glides: no fall damage, and the wind carries it.
- **Cockroach, Flatten:** it presses itself against the surface until its next turn: half damage, and blasts do not throw it.
- **Others:** to be defined, each with an ability of its own.

Special skills as attacks, each with its own attack animation (a skill is a weapon only that species has):

- **Spider web bow (in the game, as Web Bow):** the spider spins a web between two points and uses it as a bow: it pulls back and shoots, like an arrow. Aimed and charged like the other shots.
- **Ant Column (in the game):** the ant calls its nest: a column of small ants charges over the terrain, steered by the player, swarms the first enemy it meets and digs the ground away under it.
- **Titan Lift (ant):** it tears a block out of the terrain, fifty times its weight, lifts it over its head and throws it. A hole where it stood, a crush where it lands.
- **Acid Charge (ant):** it bends its abdomen forward and shoots a jet of acid that eats the terrain for two turns and hurts whoever stands in it.
- **Lightning Mandible (ant):** time stops, the mandibles open, and the ant itself is the shot: one straight dash that ends on the first bug and throws it far.
- **Blackout Swarm (cockroach, in the game):** it rubs its wings and the lights of the map fail; only eyes glow. The player marks a spot, cockroaches come from everywhere in the dark, and the light comes back on whoever they cover. Hurts every enemy in the area, hardly any crater.
- **Last Nerve (cockroach):** it runs on without its head. The body runs blind, steered only in wide turns, and bursts at the end; the head stays behind and sees it all.
- **Wing Storm (cockroach):** it opens its wings, takes off and beats up a gale: little damage, but it sweeps a whole cone of bugs away, off the map if they stand badly.
- **Fallout Charge (cockroach):** it soaks up the device's energy, glows from inside and drops head first from high up: a huge crater, and it pays with its own health (goes well with Hard Shell).
- **How special skills are earned (the skill loader is in the game; the others to come):** a match should not open with them. Ways to get one, alone or together:
  - the **skill loader** (in the game): a card per team that fills by turn and by damage done and taken, and gives one special when full;
  - **items** found on the map, which unlock or charge one;
  - **levels**: bugs or squads gain experience and unlock skills;
  - **boxes** bought with what is earned by playing.
  - Balance is kept in two layers for this (`scripts/balance.ts`): the species are even with no specials at all, and the specials are even with each other. So a limit can be added without undoing the balance; the rarer they get, the stronger they may be.
- **Unlocking and choosing skills:** more than one special per species; skills are unlocked by playing, and each squad chooses which ones it brings (a limit per squad, perhaps one per bug).
- More of the same kind: an attack that comes from the creature's body or habits, not a borrowed weapon.

Technically these fit the existing data: a species already holds its physics numbers, so an ability would be one more field, with any new action sent as a turn event like a shot.

## Items on the map (in the game)

Boxes turn up nearly every turn: small ants carry one in, or a bee lets one fall. Whoever touches a box opens it: battery (loads the special), flux patch (heals), fuse (halves the next blow), overclock (next shot hits harder), springs, thermal paste (a trap to lay), spare crystal (more time), magnet (pulls the nearest enemy), scrap (found weapons), dud (bursts). Later: boxes as loot that stays between matches.

## More species

Bees and flies (they **fly**: a new way of moving, with a limit so the ground still matters, e.g. a fuel of wing beats per turn, and landing on walls), geckos (a large one: few bugs, much health, sticks and drops its tail), and more (scorpion, beetle, moth, mite...). Each with a trait, a special and its own balance. The bee that brings boxes is the first sketch of the model.

## Building and hiding

Bugs that make the ground theirs, as an action instead of a shot, or with a limit per match:

- **Spider:** weaves an extra strong web as a barrier: it stops shots and bugs until it is torn.
- **Ant:** digs a hole and hides in it (out of sight, less damage), or builds a mound.
- **Cockroach:** to be defined (squeezes into cracks, where nothing reaches it).
- **Every bug:** walls and barriers of what the map is made of (solder, crumbs, thermal paste), small bridges.

## Modes and players

- **More players in a match:** the rules already take any number of teams (tested with four); the menu, the HUD and the camera show two. A match of many players with **one bug each**.
- **Online:** turn-based first (the simulation is deterministic: only the inputs travel), with **parties** (a group of friends that goes from match to match), invitations by link, rooms.
- **Real time, with a server behind it** (a later mode, if it proves possible): the turn-based game stays as a mode of its own. The server would run the same simulation; what is open is how to hide the delay, and the cost of carving the terrain for many at once.
- **Maps:** the menu's shelf holds six; with more, it slides sideways, as it is now.

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
