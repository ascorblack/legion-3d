# src/avatar

Procedural 3D chibi characters, the first-person view-model, nameplates and chat bubbles.

```ts
import { createAvatarKit, createLabels, appearanceFrom, RECOMMENDED_NEAR } from '../avatar';
const app = appearanceFrom(login, walkerOrHero, styleId, defaults /* (login) => flattened MDDoodle.defaultsFor | null */);
const av = createAvatarKit().create(app);        // av.root: feet at y=0, looks to −Z at rotation.y = 0
av.root.position.set(X, groundY, Z); av.root.rotation.y = walker.face;   // integrator owns the transform
av.update(dt, t, speed01);                         // 0 idle … 1 walk … 1.6 run; no allocations
av.play('wave' | 'cheer' | 'equip' | 'swing');   // arm emotes
av.play('jump'); av.play('land');                 // body states: take-off squash→stretch + tucked legs (held until 'land' or 2.5 s), landing squash
const vm = kit.viewModel(app); camera.add(vm.root); camera.near = RECOMMENDED_NEAR; // 0.03
```

- `appearance.ts` — pure TS: site PRNG (jhash/jrng), by-nick defaults (port of `MDDoodle` nickPicks for legion/cats rules), `appearanceFrom`.
- `geom.ts` — body surface generator (profile × superellipse cross-section per shape), parts merger with skin weights.
- `model.ts` — one skinned vertex-coloured geometry per look key (cached, shared by all avatars that look the same) + a low-poly LOD2 mesh. 10 bones: root, body, arms, legs, tail×2, cape×2.
- `hats.ts`, `gear.ts`, `armor.ts` — 3D hats/class helmets/accessories, weapons, shields, body armour shell (shared by heroes and item mannequins).
  Face/neck accessories are **conformed** to the outermost front surface (`surfZ`: body + face decal + armour shell): each vertex of a part built
  around z = 0 is pushed onto the surface with a clearance measured along the normal, so glasses/shades/monocle/mustache/bowtie/tie/scarf sit on
  every body shape; glasses/shades are sized from the eye style of the face decal (`eyeLayout`).
- Capes: two layers (outer colour + darker lining, 1.4 cm apart) + a double-sided rim and a rolled collar; they cover the back only (sides free for
  arms/shield) and swing backwards (negative x on the cape bones). With a tail the cape is shorter and the tail rises behind it.
- `items.ts` — item 3D models for shelves/loot/tooltips: `registerItemModels(reg)`, `itemModelKey(item)`, `itemModelKeys(item)`,
  `buildItemModel(reg, item, { ring })`, `addRarityRing(obj, rarity)`. Keys: `weapon:<kind>`, `shield:<kind>`, `armor:<kind>` (on a cat mannequin),
  `hat:<id>` (on a head form), `charm:<id>` (class charms + aura amulets), `slot:<slot>` (food by id hints, potion coloured by effect, scroll, material
  ore/gem/star/sphere/seal, relic…), `food:<site id>`, `*` (gift box). Front faces **+Z**, pivot bottom centre, cached geometry (never dispose), ≤ 1.5k tris.
  `supported.ts` lists every key (three-free, for `npm run drift`).
- `face.ts` — face decal (eyes, nose, mouth, blush, whiskers) as a canvas texture cached per face combo, projected on a body patch.
- `materials.ts` — shared MeshToonMaterial (vertex colours, 4-step ramp) with character shading on top (`TOON_SHADE`: a two-tone rim — cool sky from above, warm lamp at the sides, none on the underside — a small fill lift and a fine fur/cloth streak in the model's rest space, faded by its own screen frequency; the first-person paws use `TOON_SHADE_VM`, stronger), inverted-hull outline (skinning-aware), ghost and alpha-level variants (alpha is quantised to 8 levels so fading never clones materials), aura point shader.
- `shadows.ts` — contact shadows: a soft multiplicative disc under every avatar, ONE instanced draw per scene for the whole crowd. `Avatar.update()` stamps it (`ContactShadow`); a character that is not updated (culled, hidden, gone) drops out after 150 ms; the batch leaves the scene with its last avatar.
- `avatar.ts` — per-avatar bones + procedural animation (walk bob/legs/arms, tail sway, cape drag, breathing, emotes), LOD switching.
- `viewmodel.ts` — first-person paws + weapon/shield, mirroring the body: the weapon (bow too) always in the right paw, the shield on the left forearm whenever equipped, each forearm one straight limb (sleeve → cuff → fur wrist → paw; the closed paw = palm along the forearm + toes with creases + thumb across the grip). Layout follows the camera's fov/aspect (weapon in the lower-right quarter), idle breathing, look-sway spring, walk bob, sprint lowering, per-family swing (slash/smash/thrust/cast/bow draw/censer flick with a pendulum), `block(on)` (RMB: shield up, or weapon parry), raise-on-equip. One invisible mesh clears depth first, so it never clips into walls.
  Shield: idle = lowered, top tilted away, only the rim + a strip of its inside (iron bands, rivets) at the bottom-left ≈ 25–27 % × 10–13 % of the screen; RMB = raised over the lower-left quarter ≈ 35–40 % × 48–51 % (per-kind `SH_SCALE`/`SH_DROP` even out scutum/round/buckler/barrel). The bow is a chunkier view-model bow (`addVmBow`) standing in the aim plane, string to the camera, top canted out ~11°; censer gets a visible chain.
  Meshes are named `vm-right`, `vm-weapon`, `vm-left`, `vm-shield`; `VM_TUNE` (poses, bow, forearm axes) is read every frame so the dev page can tune it live (`__dev.VM_TUNE`, `__dev.vmGear({...})`, `__dev.vmRebuild()`).
- Held-item orientation is shared by FP and TP: `gear.ts weaponHold(kind)` maps weapon space to HAND space (grip at origin, +Y business end, −Z forward, +Z towards the holder): blades edge forward / flat sideways, axe & hammer head forward, spear blade edges forward, crook hook forward, skull faces forward, bow limbs up/down with the string towards the holder, grimoire cover towards the holder with the spine in the paw, censer hanging. `model.ts` composes it with the TP hand tilt (`TP_TILT`), `viewmodel.ts` with the FP paw poses.
- `labels.ts` — nameplates: each drawn into its own canvas on content change (an enamel-badge pill: drop shadow, gradient, light rim, level pill) and copied into a cell of ONE atlas; all shown plates are ONE instanced billboard draw, written far to near (`labels:plates`, 64 cells, LRU). Chat bubbles stay sprites with their own canvas textures. Per frame: project anchors, sort nearest-first (insertion sort, no allocations), bubbles placed first, plates skipped where they would cover a nearer label (max 20), plate sits above its bubble, own plate never in FP and yields to others in TP, on-screen size ≈ d^-0.35 (clamped), fade in/out. `configure({ showMe, range: 'all'|'near', max })`.

LOD: 0 = full (≈5.7k tris + outline + face + aura), 1 = skinned mid mesh built at half segment detail (≈2k tris, face, no outline/aura), 2 = static low mesh with eye dots + tail (1 draw call, ≈450–550 tris).
Dev page: `npm run build`, open `dist-dev/avatar.html` (`?style=cats|monkeys|legion`, `?lod=0|1|2`, `?walk=0|1`, `?cam=front|close|one|back|side`, `?solo=0,1,2`, `?vm=0`).
More modes: `?acc=1` shapes × accessory sets grid (`&sets=glasses;shades;cape&shapes=bean,ball&eyes=big&gear=1`), `?me=1` the fixture hero
(`&strip=w,s&meacc=glasses`), `?items=1` every item model on a stand (`?items=weapon,hat&rar=epic&ring=1&cols=8`), `?vmfull=1&vmi=me|<n>` full-screen
view-model (`&vmw=<weapon>|none&vms=<shield>|none&vma=<armour>&vmblock=1&vmwalk=0..1.6&vmfov=75`), `?cp=x,y,z&ct=x,y,z` camera. Keys: J — jump + land.

Combat hooks (used by `src/combat`, «Драки с котиками»; duck-typed, not part of the Avatar contract):
- bones: `B.wrist` (index 10, child of `armR` at the paw) carries the held weapon, so it can turn on its own (wrist snap of the swings,
  the TP bow draw); `B.bowString` (index 11, child of the wrist at the string centre) carries the bow's straight string, collapsed while
  the drawn-string overlay is shown. Rotation 0 / scale 1 = the old pose.
- `attacks.ts` — TP attack tracks per weapon family (slash / smash / thrust / cast / flick / slap / bonk): 12 values per key (both arms,
  body yaw/lean/dy/dz, wrist x/z) + a per-segment ease (in for strikes, out for wind-ups / follow-throughs, back for the settle).
  Every melee track: wind-up → a held anticipation (80–120 ms, crouched: body dy < 0 squashes, > 0 stretches) → fast strike → contact
  (`TP_CONTACT`, the wrist snaps through) → follow-through → settle. The body dz < 0 splits the legs into a lunge stance; a smash
  hops (dy > 0 tucks the legs) and lands with the landing squash at contact. Same timings as the FP `SWINGS` (viewmodel.ts).
  `play('swing')` picks the track of the weapon family; the first/last keys blend from/to the walk/idle pose.
- `AvatarCombat` (avatar.ts): `combatRig()` (bones + rest data for the ragdoll), `setDraw(k)` (bow draw: the body turns side-on, the
  bow arm reaches out, the bow grows ×1.65 and is canted (`BOW_CANT`), `bowdraw.ts` draws the pulled string + nocked arrow (one small
  dynamic mesh in the body bone, one draw call while drawing) and the free paw is pulled onto the nock; on release a short twang/kick),
  `arrowTip(out)`, `bladeSeg(a, b, pivot?)` (world edge of the weapon / paw for the swing trail; model data `ModelData.blade`, from
  `gear.ts bladeSpan`), `hitStop(sec)`, `setFlash(a)` (additive white skinned copy, created on first use), `setDizzy(on)` (face with
  `eyes: 'dizzy'`, `mouth: 'wobble'` from face.ts).
- view-model: `setDraw(k)` (raise to aim, nocked arrow `vm-nock`, the left paw pulls the string — `VM_TUNE.pull`), `hitStop(sec)`,
  `swingReady`, `swingTime`, `bladeSeg(a, b)`, `arrowTip(out)`; `weaponFamily(w)` is exported.
