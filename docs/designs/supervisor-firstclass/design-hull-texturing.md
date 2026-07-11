# Visual-Hull Texturing — Definitive Design (v1)

**Status:** Approved design. **Winner:** weighted-vertex-blend, with cheap grafts.
**Target bar:** "looks good for a stylized 8-bit game character in three.js" — buildable tool, not studio-grade.
**Deps (hard):** `sharp` + `ffmpeg` ONLY. No ML/colmap/blender/python. Pure TS, no GPU.

---

## 1. Vision

The current single-view-pick vertex coloring is structurally wrong in two cheap-to-fix ways and one expensive-to-fix way:

1. **Green chroma fringe speckle** — sampling antialiased edge pixels off a loose binary mask, with no despill. *Loudest defect, nearly free to kill.*
2. **Hard color seams** — winner-take-all argmax over views means adjacent surface voxels flip between differently-lit frames. *Fix with continuous blending.*
3. **Blocky Lego look** — cube-soup + flat normals. *Real, but a SEPARATE geometry lever, not a texturing prerequisite. Deferred.*

The color content is already correct and placed right (the baseline `novel-views.png` proves it: pink mohawk, dark jacket, denim, sneakers all land). So the win is a **sampling-quality** fix, not a resolution or geometry fix. We stay on **vertex colors** (`COLOR_0`) — the smallest GLB, zero unwrap, zero new material plumbing, and the foundation every richer approach would build on anyway.

The plan: **despill + 1px sampling-mask erosion → cosine-weighted, visibility-gated, weighted-median multi-view blend over despilled frames → keep vertex-color GLB, welded + ubyte-packed.** Optional `--retro` palette quantize on top as the on-brand 8-bit hedge.

---

## 2. The chosen algorithm (build-ready)

All math reuses the carve projection verbatim. Conventions (from `visualhull.ts`): front at `i=0`, `th = 2*PI*i/NV`, grid center `cc=(GRID-1)/2`, `cx`=screen rotation-axis column, `top`=min foreground row, `scale=charH/GY` px/voxel, `y=0` is grid bottom.

### 2.0 Orthographic voxel -> pixel projection (the one shared map)

For voxel/vertex `(x,y,z)` and view `i`:
```
th  = 2*PI*i/NV
Xw  = x - cc ;  Zw = z - cc ;  Yw = y
u   = Xw*cos(th) + Zw*sin(th)              // screen-right
col = round(cx + u*scale)
row = round(top + (GY-1-Yw)*scale)         // y=0 bottom
depth = -Xw*sin(th) + Zw*cos(th)           // toward-camera (perpendicular axis, el=0)
camDir_i = (sin(th), 0, cos(th))           // world XZ camera-toward
```
`depth` is the missing companion to `(u,col,row)` and is the ONLY new piece of projection math. **Use identical `round()` in both the z-buffer rasterize and the sample test** so they stay consistent (this is what makes the occlusion gate safe).

### 2.1 Source-frame cleanup (fringe kill at the source) — in the `sils` build loop (~lines 41-46)

Per frame, produce:
- **`carveMask`** = existing binary `dist>TOL` mask. UNCHANGED — carving must keep the full silhouette or geometry shrinks.
- **`sampleMask`** = `morph(carveMask, W, H, 1, 'erode')` (lifted from `removeBg.ts`). Trusted-interior only; color sampling reads this, never `carveMask`.
- **`conf[i]`** (edge confidence) = run 2-3 erosion passes counting passes-survived per pixel; `conf = survived/maxPasses` (1.0 deep interior -> 0 near rim). Feathering weight.
- **Despill `rgb` in place** for kept pixels (`removeBg` math, keyChannel=green, despill~0.6):
  ```
  if (g > (r+b)/2) g = round(g - (g - (r+b)/2) * 0.6)
  ```

### 2.2 Per-view software z-buffer (visibility — the load-bearing addition)

Once, before texturing. For each view `i`, `depthBuf[i] = Float32Array(W*H).fill(-Infinity)`. Rasterize **all exposed voxels** (same `exposed()` set the emit uses):
```
project(x,y,z,i) -> col,row,depth        // formula 2.0
if depth > depthBuf[i][row*W+col]: depthBuf[i][row*W+col] = depth
```
A voxel is **visible in view i** iff `depth >= depthBuf[i][row*W+col] - DELTA`, `DELTA ~= 1.5` (≈1 voxel). This stops back-of-body voxels stealing front colors.

### 2.3 Smoothed 3-component normal (prerequisite for smooth weighting)

Current normal is 2-component ±1 (no Y, too coarse). Upgrade to a smoothed gradient over the 3³ neighborhood:
```
nx = sum over 3x3 in (y,z) of [occAt(x-1,*,*) - occAt(x+1,*,*)]
ny = sum over 3x3 in (x,z) of [occAt(*,y-1,*) - occAt(*,y+1,*)]
nz = sum over 3x3 in (x,y) of [occAt(*,*,z-1) - occAt(*,*,z+1)]
normalize (nx,ny,nz)
```

### 2.4 Per-voxel weighted-median blend (replaces the texture loop ~lines 92-117)

For each exposed voxel, collect candidate samples from every view passing BOTH gates:
```
samples = []
for i in 0..NV-1:
  cdot = nx*sin(th_i) + nz*cos(th_i)          // cosine(normal, camera)
  if cdot <= 0: continue                        // back-facing view
  project(x,y,z,i) -> col,row,depth
  if out of bounds: continue
  if !sampleMask[i][row*W+col]: continue        // ERODED interior only (fringe gate)
  if depth < depthBuf[i][row*W+col] - DELTA: continue   // OCCLUSION gate
  w = pow(cdot, K) * conf[i][row*W+col]          // K=3; feather by edge confidence
  samples.push({ r,g,b: despilledRGB@(col,row), w })

// Blend = WEIGHTED MEDIAN per channel (sort by channel, pick cumulative-weight midpoint)
//   - rejects any single fringe/specular/occlusion-leak outlier
//   - if samples.length <= 2: fall back to weighted MEAN (median needs >=3)
//   - if samples.length == 0: leave unset, fill in a final neighbor-flood pass
colOf[idx] = pack(weightedMedianOrMean(samples))
```

**Why both defects die:**
- *Fringe* — eroded `sampleMask` never samples the rim; despill cleans residual tint; weighted-median rejects survivors. Triple defense.
- *Seams* — color is a continuous weighted average over 2-4 frontal views instead of a discontinuous argmax. `K=3` keeps it sharp (mostly-frontal) without the hard single-pick step. Adjacent voxels share most contributing views -> smooth variation.

**Tuning knobs:** `K` (2-4; 3 default), `DELTA` (1-2 voxels), `despill` (~0.6), erosion passes (2-3).

### 2.5 Empty / occluded voxels

Final pass over `colOf`: any unset voxel inherits the average of its already-colored 6-neighbors (flood). No gray holes in deep crevices/armpits.

---

## 3. Grafts (all cheap, orthogonal, recommended)

1. **`--retro` palette quantize (from retro-palette-flat).** After the blend, median-cut the final vertex colors to a small global palette (16/24/32). ~60 LOC. Sits ON TOP of the blend for free; hides residual fringe in a palette bucket; the on-brand hedge if the smooth blend reads washed/uncanny. Ship as a flag, default off.
2. **Weld verts + `UNSIGNED_BYTE` `COLOR_0` (from geometry-first/retro).** Dedup the 8-corner cube verts via a position->index map, and store color as normalized ubyte vec4 instead of float. ~20-30 LOC. Cuts the ~1.6 MB GLB to roughly 300-500 KB with ZERO visual change, and is a prerequisite for any later smooth-normal upgrade. Do regardless.
3. **Y-aware smoothed normal (2.3)** — shared primitive, needed for sane vertical-face weighting.

---

## 4. Geometry smoothing — IN SCOPE? No (deferred, by design)

Marching cubes + smooth normals + Taubin is the **highest-ceiling NEXT lever** — the baseline shows blockiness dominates perception. But it is a **separate** lever, NOT a texturing prerequisite:
- Color content is already correct on cube-soup; fringe+seams are pure sampling defects fixable without touching geometry.
- MC is ~375 LOC with hand-rolled lookup tables; a winding/table bug ships holes. High build risk for v1.

**Decision:** defer MC. Only invest AFTER Phase 1+2 prove color-alone isn't enough. The weld graft (3.2) is the bridge — it makes the mesh shared-vertex, which is the substrate MC + smooth normals need later. If we go there: carve at 96³, box-blur `occ` to a scalar field, MC the 0.5 isosurface with `t=(0.5-f0)/(f1-f0)` edge interpolation, weld, 2-4 Taubin passes (λ=+0.5/μ=-0.53), area-weighted vertex normals, then re-run the SAME blend (2.4) per MC vertex (projection is continuous in world coords, so it just works).

---

## 5. Data flow into `visualhull.ts`

**Reads (all in scope at ~line 92):** `occ`, `idx`, `occAt`, `exposed`, `sils[]`, `NV`, `cx`, `top`, `scale`, `cc`, `GRID`, `GY`. Projection: formula 2.0 (extends carve lines 80-83 with `depth`).

**Hooks:**
1. **~Lines 41-46 (`sils` build):** add despill in place; add `sampleMask` (erode) + `conf` (2-3 erosion passes) via `morph`. Keep `carveMask` for carving.
2. **New block after carve (~after line 90):** build `depthBuf[i]` per view by rasterizing exposed voxels. ~25 LOC.
3. **Replace ~lines 92-117:** smoothed-normal helper + weighted-median blend + neighbor-flood fill. Writes the SAME `colOf: Uint32Array`. ~75 LOC.
4. **GLB emitter (~139-182):** weld verts + index sharing + `COLOR_0` as normalized ubyte vec4 (graft 3.2). ~25 LOC. PLY stays vertex-colored, unchanged otherwise.

**Reuse from** `tooling/imagegen/pipeline/removeBg.ts`: `morph()` (erode) + despill math.

**Optional debug output:** per-view visibility-mask PNGs (to tune `DELTA`).

---

## 6. Output format + three.js notes

**Vertex-color GLB** — `POSITION` + `COLOR_0` (welded, indexed, ubyte-normalized). **No UVs, no texture, no material/image/sampler block.** PLY also emitted (vertex color), standalone.

- **Size:** ~300-500 KB after weld+ubyte (down from ~1.6 MB cube-soup). Color adds nothing meaningful.
- **three.js:** loads via `GLTFLoader` unchanged. `GLTFLoader` auto-enables `vertexColors` when `COLOR_0` is present. For the cleanest 8-bit read use `MeshBasicMaterial` (unlit — colors render exactly as baked); or one directional + ambient with `MeshStandardMaterial` if you want some shaping. GLTFLoader handles color-space. Flat cube normals remain until the deferred MC lever.

---

## 7. Dependencies

`sharp` (decode + despill/erode reuse) + `ffmpeg` (demux) ONLY. Nothing added. Median-cut, z-buffer, blend, weld are hand-rolled pure TS. Runtime ~1-2 s on a GPU-less Mac (z-buffer ~240k ops, blend ~10k voxels x 24 views, erosion a few M ops).

---

## 8. Phased build order (de-risked)

**Phase 1 — Fringe kill, ship first (~25 LOC, near-zero risk).**
Despill + 1px `sampleMask` erosion against the CURRENT single-view-pick cube-soup. This kills the loudest defect (green speckle) and lets us judge color vs geometry separately. If this alone "looks good enough," 75+ LOC saved. (It won't fully — seams remain — but it proves the fringe theory.)

**Phase 2 — The blend (main lever).**
Add smoothed normal + per-view z-buffer + cosine-weighted weighted-median blend + neighbor-flood fill. Keep `DELTA` tunable; emit per-view visibility PNGs to tune it. **Fallback:** if `DELTA` proves unstable (holes), DROP the occlusion gate and rely on cosine + median alone — degrades gracefully (minor back-bleed on deep concavities only).

**Phase 3 — Cheap grafts.**
Weld + ubyte `COLOR_0` (shrinks GLB, enables future MC). Add `--retro` palette quantize flag.

**Phase 4 — DEFERRED, only if needed.**
Marching cubes + smooth normals + Taubin as the geometry lever. Invest only after 1-3 prove color-clean cube-soup still reads too blocky.

---

## 9. Why over alternatives + top risks

**Why weighted-vertex-blend wins (judge total 33):** minimum-change, smallest GLB, zero unwrap, pure drop-in to `colOf` (zero emit changes for Phase 1-2), and the foundation every other concept builds on. Triple-defense fringe kill + continuous blend directly target both loud defects.

**Dropped:**
- **projective-paint-atlas (23):** sub-voxel albedo (decals/logos) is a non-goal at 8-bit on a still-blocky hull; adds the most failure surface (UV + material + embedded-PNG plumbing, mip shimmer). Revisit ONLY if a crisp-decal requirement appears — the one thing vertex colors genuinely can't do.
- **triplanar-no-unwrap (27):** structurally seam-free but discards 18 of 24 oblique frames and smears diagonals (shoulders/mohawk) + synthetic Y-caps, for no LOC win over the blend.
- **geometry-first (25):** highest LOOK ceiling but ~375 LOC MC-table risk; it's a separate lever, deferred to Phase 4.
- **retro-palette-flat (32):** kept as a `--retro` graft on top of the blend rather than the base, so we don't bet the whole result on the chunky aesthetic.

**Top risks:**
1. **`DELTA` (occlusion tolerance)** — too tight = self-rejection holes; too loose = back-bleed. Mitigated by identical rounding in rasterize+test, debug visibility PNGs, and the graceful "drop the gate" fallback.
2. **Thin features (mohawk tips, hands)** — noisy normal -> weight wobble. Mitigated by median + multi-view averaging and not over-cranking `K`.
3. **Residual blockiness** — fixed color on Lego may still read blocky; this is geometry's job (Phase 4), explicitly out of texturing scope.
4. **Concavity color is invented** (hull over-approximation) — fed by grazing views / neighbor-flood; a geometry-acquisition limit, not fixable in texturing. `--retro` makes the invention less noticeable.

---

## 10. Expected look

Green speckle gone. Color continuous across the surface (no view-flip seams) but still crisp (K=3 keeps it frontal). Reads as a clean, slightly-soft stylized character — correct colors, no glitches — sitting on chunky cube geometry. With `--retro`, a flat 16-32 color voxel-sprite look that is fully on-brand for an 8-bit fighter. The remaining honest gap is blockiness, which Phase 4 (MC) addresses if/when the chunky look is judged unintentional rather than retro.
