# yolox-markup ("Annotator") — Integration Research

**Path:** `/Users/benmaderazo/Code/yolox-markup`
**One-liner:** A local-first annotation + model-training platform for object detection. Upload images → draw bounding boxes → train YOLO models → auto-label new data → evaluate → export/deploy to OAK cameras. All driven from one browser UI (also shipped as an Electron desktop app).

---

## 1. What it IS — end-to-end scope & tech stack

It does **both** annotation **and** training (a full loop), plus capture, synthetic data, and edge deployment.

Pipeline: **Capture/Upload images → Annotate (bboxes) → Split (train/val/test) → Train (YOLOv8) → Evaluate (mAP/P/R) → Auto-label remaining images with the checkpoint → Export `.blob` → Deploy to OAK camera.** Auto-label feeds annotations back into the loop (human-in-the-loop active learning).

**Tech stack:**
- Frontend: React 18, TypeScript, Vite, Tailwind, Zustand (`frontend/`). Dev port 5182.
- Backend: FastAPI, SQLAlchemy async, **SQLite**, Pydantic v2 (`backend/src/annotator/`). Port 8082.
- ML: YOLOv8 (Ultralytics) / YOLOX; COCO eval metrics. Training runs as a **spawned subprocess**, streaming metrics over WebSocket. Requires CUDA GPU.
- Capture: remote `oak-capture-server` over SSH (`oak_capture_server/` here is a copy; real one is remote).
- Desktop: Electron wrapper (`desktop/main.js`) — universal mac + Windows builds.
- **MCP server already exists** (`annotator-mcp`, `backend/.../mcp_server.py`) exposing ~30 tools to Claude Code.

Monorepo: npm workspaces (`frontend`, `backend`); backend also uses `uv`/pyproject.

---

## 2. Annotation workflow

- **Producer:** a human in the **AnnotationCanvas** (React) drawing bounding boxes — OR the **auto-label** service producing *draft* annotations from a trained checkpoint.
- **Format:** stored as DB rows (`annotations` table): `class_id, x, y, w, h`, optional polygon `points` (JSON), `is_draft` bool, `confidence`. Import/export in **COCO** JSON. Models export to YOLO dataset layout for training.
- **UI/CLI:** interactive canvas (undo/redo, copy/paste across images, keyboard shortcuts) + REST API + MCP tools (`save_annotations`, `copy_annotations`, `import_coco`, `export_coco`).
- **Task/queue notion:** **No explicit task/job queue or assignment.** The closest thing is the per-image **status lifecycle** on the `images` table: `unlabeled → in_progress → complete → reviewed`. Images are filterable by status, which acts as an informal work queue. There is a stats endpoint (`get_annotation_stats`) counting images per status — the natural "how much work is left" signal.

---

## 3. Training workflow

- **Launch:** `POST /api/projects/{id}/train` (also MCP `start_training`). Validates dataset, estimates VRAM, prepares data, spawns a training **subprocess**. Returns 409 if already running (one run per project at a time, tracked in-memory `_active_processes[project_id]`).
- **Config:** `TrainRequest` hyperparameters + per-project `config.json` (classes etc.); a `config_snapshot` JSON is frozen into the `training_runs` row.
- **Monitor:** real-time **WebSocket** metrics stream (`MetricsMessage`); `metrics.jsonl` written to the run dir; GPU/VRAM tracking (`vram_service`). Endpoints: `get_training_log`, `get_run_metrics`, `stop_training` (SIGTERM→SIGKILL), `resume_training`.
- **Artifacts per run:** `run_dir` (e.g. `models/runs/run_1` / `backend/runs/`), `metrics.jsonl`, checkpoint weights (`*.pth`) — auto-pruned to the **top-N best by mAP** (`_prune_checkpoints`, default keep 3). `best_mAP` recorded on the run row.
- DB tables: `training_runs`, `export_runs` (onnx→openvino→oak `.blob` pipeline with status enum), `synthetic_runs`.

---

## 4. Where HUMAN work enters the loop

Annotation is **inherently a human task** here — there is no agent-driven labeling concept beyond auto-label (which is the *model* labeling, then a human reviews/accepts drafts). Human entry points:

1. **Annotating images** — drawing bboxes on `unlabeled`/`in_progress` images (the primary human task).
2. **Reviewing auto-label drafts** — auto-label writes `is_draft=true` annotations; a human accepts/undoes them (drafts are explicitly undoable). This is the human-in-the-loop QA gate.
3. **QA / review status** — promoting images to `reviewed` (final sign-off).
4. **Class config & dataset curation** — defining classes, splits, deciding what to capture/import.

This maps cleanly onto an orchestration platform: **annotation + review are user (human) work items**; capture, training, auto-label, export, evaluation are **mechanical/agent-or-daemon work**. The `unlabeled→...→reviewed` status field is the per-image work-state that a task/assignment layer could wrap.

---

## 5. Artifacts to track (binary / large)

| Artifact | Where | Binary/large? |
|---|---|---|
| Source images | `data/` (per-project dirs) | **Yes — large, many files** (gitignored `data/`, `projects/`) |
| Annotations | SQLite rows + COCO JSON export | Small/text |
| Datasets (YOLO/COCO export) | generated under data/run dirs | Medium, text+image refs |
| Model checkpoints | `*.pth` in `runs/run_N/` | **Yes — large binary** (gitignored `*.pth`, `backend/runs/`) |
| Metrics | `metrics.jsonl` per run | Small/text |
| Export outputs | `onnx_path`, `openvino_path`, `oak_path` (`.blob`) | **Yes — binary** |
| Synthetic runs | `synthetic_runs.run_dir` | Image output, large |

`.gitignore` confirms all heavy artifacts (`data/`, `projects/`, `*.pth`, `backend/runs/`, `desktop/release/`) are **excluded from git** — they are external blobs the orchestration layer must reference by path/handle, not store in-repo.

---

## 6. Multi-user / assignment / queues — current state

**None.** Single-user, local-first design:
- No auth/login/`current_user`, no `assignee`/`owner`/`assigned_to`, no task or job queue tables. (grep for these came up empty; the only "authorization" mentions are docstring placeholders in `export.py`.)
- Concurrency is single-run-per-project, enforced via in-memory dicts (`_active_processes`, `_monitor_tasks`) — **not durable**, lost on restart.
- The only built-in "work state" is the image `status` enum and `training_runs.status` / `export_runs.status` / `synthetic_runs.status`.

**Implication for integration:** the orchestration platform (claude-mermaid-collab) would supply the missing layer — assignment, queues, multi-user, durable task graph — wrapping yolox-markup's existing per-image status + per-run status as the underlying state. An MCP server already exists to drive every operation programmatically, so an agent/coordinator can fully control projects, images, annotations, training, inference, and capture without touching the UI.

---

## Key DB tables (state surface)
`projects`, `images` (status lifecycle), `annotations` (is_draft/confidence), `image_splits` (train/val/test), `training_runs`, `export_runs`, `synthetic_runs`, `capture_sessions`, `remote_services`.

## Key files
- `backend/src/annotator/models/db.py` — ORM / full state model
- `backend/src/annotator/mcp_server.py` — ~30 MCP tools (already Claude-drivable)
- `backend/src/annotator/services/training_service.py` — subprocess + checkpoint pruning
- `backend/src/annotator/services/annotation_service.py` — status transitions, stats
- `backend/src/annotator/routers/` — REST endpoints per domain
- `README.md` — authoritative overview
