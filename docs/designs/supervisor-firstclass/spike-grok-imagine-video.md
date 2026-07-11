# Spike: Grok Imagine image→video (IMG A1)

Spike date 2026-06-13. Goal: seed a specific image, get multiple animations, judge fidelity to the original, and test the transparency path. Subject: an 8-bit punk-rock angry character for **FigureHate** (a 1v1 ice-skating game).

## API (verified live)

**Video models** (`GET /v1/video-generation-models`):
- `grok-imagine-video` — input `text,image,video` → `video`
- `grok-imagine-video-1.5-preview` — input **image only** → `video` (used here; best fidelity)

**Submit (async):** `POST /v1/videos/generations`
```json
{ "model": "grok-imagine-video-1.5-preview",
  "prompt": "<steering text>",
  "image": { "url": "data:image/png;base64,..." } }   // image MUST be an object {url} (data-url ok), not a string
→ 200 { "request_id": "<uuid>" }
```
- Text-to-video NOT supported on 1.5-preview — image is required.
- `image.b64_json` rejected; must be `{ url }` (a `data:` URL works) or `{ file_id }`.

**Poll:** `GET /v1/videos/{request_id}`
```json
202 { "status": "pending", "progress": 0..100 }
200 { "status": "done", "progress": 100,
      "video": { "url": "https://vidgen.x.ai/...mp4", "duration": 8 },
      "usage": { "cost_in_usd_ticks": 6500000000 } }
```
- Terminal status is **`done`** (not `completed`/`succeeded`). Video at `video.url` (temporary — download immediately).
- **Cost: 6.5e9 ticks = $0.65 per 8-second clip.** Fixed 8s duration observed. Generation ~1–2 min.

## Results — fidelity

All 4 clips (skate-forward, attack, idle, spin) kept the character **highly recognizable**: mohawk, studded leather, ripped jeans, skates all preserved across the 8s. Style stays 8-bit-ish but **softens** vs the crisp source (video codec + model upscaling smooths the hard pixel grid). Re-pixelating frames via the existing `downscale` (nearest) restores a clean sprite look.

**Steering is weak.** 1.5-preview is image-pose-dominated — it mostly produces the *base* motion (skating/lunging forward) regardless of the prompt. "Attack" read as an aggressive lunge, "spin" did not do a true 360. Takeaway: **the seed image's pose drives the result; the prompt nudges, it does not choreograph.** For distinct game states (idle/run/attack/spin) we should **seed a distinct pose image per state** (use the P5 img2img/turnaround to make the poses first), then animate each.

## Results — transparency (WORKS)

The chroma-green background is **retained consistently through the whole video**, so the existing P3 `removeBackground` chroma-key pipeline applies frame-by-frame. Proven end-to-end:
`mp4 → ffmpeg extract frames → removeBackground (key #00b140, tol 110, despill 0.6) → downscale(64px nearest) → packed transparent sprite sheet`. Cutout is clean (checkerboard shows through, minor fringe). So: **seed on solid chroma → animate → key each frame = transparent animated sprite sheet**, no native-alpha video needed.

## Pipeline shape this implies

1. Generate base/pose image(s) on solid chroma (existing image provider).
2. `grok-imagine-video-1.5-preview` image→video per pose (async submit/poll).
3. ffmpeg extract frames at target fps.
4. P3 `removeBackground` + `downscale` per frame.
5. `packSheet` → atlas + manifest (three.js Billboard.setFrames — same as static P3).

## Next / productize (IMG P6 candidate)

- Add a `video` method to `ImageProvider` + an `xaiVideo` provider (submit/poll/download), `VideoGenOptions` (model, prompt, seedImage, fps, postprocess).
- Frame-extract stage (ffmpeg dependency — note: sharp can't demux mp4).
- Reuse removeBg/downscale/packSheet for animated sheets.
- Cost guard: $0.65/clip is ~9× a 2k still — gate behind explicit opt-in / session budget.
- Per-state seed poses via P5 turnaround to beat weak prompt-steering.

## UPDATE 2026-06-14 — model comparison + the turnaround breakthrough

**Two video models compared** (corrected base `punk2-base.png`, pink/purple mohawk, no green in the character):
- `grok-imagine-video` (text+image) — **$0.40/clip**, **stronger prompt steering** (spin actually rotated, attack hit an impact burst), but can over-FX at the motion climax (character partly dissolves into ice-spray in the last ~1s).
- `grok-imagine-video-1.5-preview` (image-only) — $0.65/clip, ultra-stable identity, weak steering (replays base skate). Use for fidelity-critical states; use `grok-imagine-video` for choreographed actions.

**Chroma-key failure mode confirmed + fixed.** First base had GREEN mohawk tips → green-key ate the hair (subject contains the key color — color-keying can't separate hair-green from bg-green). Fix: keep the key color OUT of the character (regenerated with pink/purple mohawk). Also: key at FULL RES then downscale ONCE (the first spike double-downscaled: 240px-wide frames → 64px tall = tiny 48×64). `pixelHeight` is tunable; 192–256 is a good sprite size.

### BREAKTHROUGH — multi-angle turnaround via VIDEO CAMERA-ORBIT (beats img2img)
Prompt `grok-imagine-video` with "**camera orbits 360° around the character, character frozen, only the camera moves**" → extract frames at each angle. Result (`orbit.mp4`, frames `orbit-t3/4/5.png`):
- **t3.0s clean left profile · t4.0s CLEAN TRUE REAR (back of head, no face) · t5.0s ¾-back.** Identity held the whole way around.
- **This solves the P4/P5 rear-view weakness**: independent img2img redraws a face on the back because each angle is generated blind; a video orbit interpolates *continuously* through the rear, so temporal coherence carries the back-of-head around. **One $0.40 call = the whole turnaround** vs ~8 separate img2img gens.
- Caveats (prompt-fixable): model adds locomotion (push "perfectly still statue, zero body motion"); ground stays in the cutout (prompt "no ice, plain green void, floating"); orbit steps aren't exactly even 45° — SELECT frames at the true target angles, don't blind-sample.
- **→ Reshapes P5 (613ce4ed): turnaround = video-orbit primary, img2img = single-frame touch-up only (mirror L/R with sharp.flop()).**

## UPDATE 2026-06-14 (2) — image→3D MODEL via orbit visual-hull (NEW capability)

Tested whether Grok can drive a 3D model. **Two findings:**

**(a) The "slice the character into cross-sections" idea does NOT work.** Asked Grok for a horizontal waist cross-section → it returned a *top-down VIEW of a torso* (navel visible), not an abstract geometric slice. The model renders a familiar picture, has no internal-geometry concept; independently-generated slices wouldn't be mutually consistent anyway. Abandoned.

**(b) Orbit → visual-hull (shape-from-silhouette) WORKS — pure geometry, no ML, no external service.** The turntable orbit is effectively a photogrammetry capture. Pipeline (`/tmp/spike-figurehate/visualhull.ts`):
`frozen T-pose image → grok-imagine-video turntable orbit ($0.40) → ffmpeg N frames → chroma silhouettes → voxel carve (a voxel survives only if it projects inside EVERY silhouette) → multi-view texture (color each surface voxel from the view whose camera best faces its normal) → PLY + GLB + novel-view renders`.
- Result: 12,086 voxels, recognizable from front/side/back/¾ **rendered from the mesh** (angles Grok never drew) — true depth, not a flat card. Files: `hull/punk.ply`, `hull/punk.glb` (53.6k tris, loads in three.js GLTFLoader), `hull/novel-views.png`.
- Frozen rigid **T-pose is essential** (moving limbs break silhouette intersection; arms-out minimizes the hull's concavity fill).
- KNOWN LIMITS: visual hull is a convex-ish over-approximation (fills armpits / between-legs / under-chin concavities); multi-view texturing fixed the back-colors but leaves **green speckle from edge chroma fringe** (fix: erode mask 1px / sample despilled frames); orbit angle assumed perfectly even (front@frame0, 360°/8s) — a symmetry-calibration pass would sharpen; cube-soup blocky look (swap for marching-cubes if smooth wanted, but blocky is on-theme for 8-bit).
- Toolchain note: NO local colmap/blender/torch/numpy — this is deliberately dependency-free (sharp + ffmpeg only). Neural image→3D (TripoSR/Gaussian-splat) remains an alternative if hull quality is insufficient.
- **→ This is a distinct new capability ("image→3D model") on the same orbit primitive. Filed as its own phase.**

## SHIPPED 2026-06-14 — v5.101.0 (master) — generate_sprite_sheet + Grok MCP tools

Built, committed (452f36a + dbb7a22), merged to master, tagged v5.101.0, pushed. Four MCP tools wired into the server (src/mcp/tools/image.ts, setup.ts; routes in src/routes/api.ts):
- `generate_image` — text → still image artifact (no ffmpeg dep).
- `generate_sprite_animation` / `generate_sprite_rotation` — video → keyed sheet (building blocks).
- `generate_sprite_sheet` — **RECOMMENDED** spec-driven directional-animation sheet.

### THE VALIDATED RECIPE (what generate_sprite_sheet does)
`{character, animation, frames N(≤8), angles Y}`:
1. IMAGE: a grid (≤6/row, multi-row for more) of N frozen animation poses, WIDE gaps, each on its OWN solid **cyan turntable pedestal disc**, seamless loop, no text/lines, chroma-green bg. (~$0.07)
2. VIDEO: orbit the grid framed as **"N frozen plastic action figures, each on its own motorized turntable pedestal, spinning in place, poses NEVER change, only pedestals rotate"** → ONE clip rotates every cell in place, in sync, poses held. (~$0.40)
3. POST (deterministic, tooling/imagegen/pipeline): extract Y angle-frames → **multi-color key** (green + cyan marker in one pass, removeBg keyColors[]) → **sliceGrid** rows×cols → **autocropRecenter** each cell uniform → **packSheet** [angles × poses] + manifest {frames,angles,rows,cols,fps}.
≈ **$0.47 per full directional action**, any frame count.

### KEY PROMPTING LESSONS (the unlocks)
- **Frame cells as PHYSICAL OBJECTS** ("frozen action figures / statues on a turntable"), not characters — makes the video model rotate rigidly in place instead of animating. The model is a *continuous-motion generator*; it will NOT hard-cut/stop-motion/hold discrete stills (tested 3×: stop-motion, hard-cut slideshow, both ignored).
- **Unique-color pedestal = a removable pivot MARKER.** The disc gives each figure an explicit rotation center (fixed the drift) AND, in a color absent from the character (cyan), keys out cleanly with the bg in one multi-key pass. A green/chroma-colored pedestal leaves a ghost ring — don't.
- **Gap ≥ figure width** — rotation widens the silhouette (a forward punch becomes a sideways arm in profile), so neighbors collide without margin.
- **~6–8 poses/row max** before the model clones poses (limit is pose-distinctness + gap, not resolution); use a **multi-row grid** for more (orbit-in-place holds per-cell across rows — tested 2×6).
- **One clip can carry angles for ALL poses** (grid-orbit) — angle axis collapses to a single $0.40 video; the per-frame-orbit ($0.40×N) version is unnecessary.
- Two video models: `grok-imagine-video` (text+image, $0.40, steers better) vs `grok-imagine-video-1.5-preview` ($0.65, image-only, ultra-stable).

### DEPLOY NOTE
ffmpeg/ffprobe now **bundled** (ffmpeg-static/ffprobe-static → copied into desktop/resources by build-sidecar.ts → extraResources; frames.ts resolveBin: env → MERMAID_RESOURCES_PATH → static pkg → PATH). Routes 501 if absent. Tools appear only after sidecar rebuild + fresh Claude session.

### ABANDONED: 3D (IMG P7 visual-hull) — deferred per user ("stick with 2D")
The orbit→visual-hull→GLB worked (real mesh, novel views) but texture quality stayed rough; per-cell multi-view texturing + the cube-soup geometry weren't good enough, and the game only needs 2.5D billboards. Code is in /tmp/spike-figurehate/visualhull.ts (not shipped). Revisit only if true 3D is needed.

## Cost this spike
1 base ($0.07) + 4× 1.5-preview ($2.60) + 2× grok-imagine-video actions ($0.80) + 1 base redo ($0.07) + 1 orbit ($0.40) ≈ **$3.94**. Artifacts in `/tmp/spike-figurehate/` (helper `vidgen.ts`; /tmp is volatile).
