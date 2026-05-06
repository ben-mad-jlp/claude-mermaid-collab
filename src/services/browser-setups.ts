import { mkdir, readFile, writeFile, unlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  browserNavigate, browserClick, browserFill, browserFillReact,
  browserTypeText, browserSelect, browserPressKey, browserWaitFor,
  browserScreenshot, browserEvaluate, browserGetUrl,
} from '../mcp/tools/browser.js';

export type SetupStep =
  | { action: 'navigate';      url: string;                                         label?: string }
  | { action: 'click';         selector: string; text?: string;                     label?: string }
  | { action: 'fill';          selector: string; value: string;                     label?: string }
  | { action: 'fill_react';    selector: string; value: string;                     label?: string }
  | { action: 'type';          selector: string; text: string;                      label?: string }
  | { action: 'select';        selector: string; value: string;                     label?: string }
  | { action: 'press_key';     key: string;                                         label?: string }
  | { action: 'wait';          ms: number;                                          label?: string }
  | { action: 'wait_for';      selector: string; timeout?: number;                  label?: string }
  | { action: 'wait_for_text'; text: string; selector?: string; timeout?: number;  label?: string }
  | { action: 'screenshot';                                                          label?: string }
  | { action: 'eval';          eval: string; as?: string;                           label?: string }
  | { action: 'run_setup';     setup: string; parameters?: Record<string,string>;  label?: string }

export interface SetupCheck {
  url_contains?: string;
  selector?: string;
}

export interface SetupDef {
  name: string;
  description?: string;
  steps: SetupStep[];
  parameters?: Array<{ name: string; default?: string }>;
  check?: SetupCheck;
  created: string;
  modified: string;
}

export interface StepResult {
  index: number;
  action: string;
  label?: string;
  status: 'ok' | 'failed' | 'skipped';
  durationMs: number;
}

export interface RunResult {
  success: boolean;
  skipped?: boolean;
  stepsRun: number;
  durationMs: number;
  stepResults?: StepResult[];
  error?: string;
  errorStep?: number;
  errorUrl?: string;
  errorScreenshot?: string;
}

export class CircularSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircularSetupError';
  }
}

interface RunOpts {
  parameters?: Record<string, string>;
  start_step?: number;
  step_timeout_ms?: number;
  smart_skip?: boolean;
  _callChain?: Set<string>;
}

export function setupsDir(project: string, session: string): string {
  return join(project, '.collab', 'sessions', session, 'setups');
}

function validateSetupName(name: string): void {
  if (!name || /[/\\]/.test(name) || name === '..' || name.includes('..')) {
    throw new Error(`Invalid setup name: "${name}" — must not contain path separators`);
  }
}

export async function saveSetup(project: string, session: string, def: SetupDef): Promise<void> {
  validateSetupName(def.name);
  const dir = setupsDir(project, session);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${def.name}.json`), JSON.stringify(def, null, 2), 'utf-8');
}

export async function getSetup(project: string, session: string, name: string): Promise<SetupDef> {
  validateSetupName(name);
  try {
    const raw = await readFile(join(setupsDir(project, session), `${name}.json`), 'utf-8');
    return JSON.parse(raw) as SetupDef;
  } catch {
    throw new Error(`Setup "${name}" not found`);
  }
}

export async function listSetups(
  project: string,
  session: string,
): Promise<Array<{ name: string; description?: string; stepCount: number; modified: string }>> {
  const dir = setupsDir(project, session);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
  const results: Array<{ name: string; description?: string; stepCount: number; modified: string }> = [];
  for (const f of files.filter(f => f.endsWith('.json'))) {
    try {
      const def = await getSetup(project, session, f.replace(/\.json$/, ''));
      results.push({ name: def.name, description: def.description, stepCount: def.steps.length, modified: def.modified });
    } catch {
      // skip corrupt/unreadable setup files
    }
  }
  return results.sort((a, b) => b.modified.localeCompare(a.modified));
}

export async function deleteSetup(project: string, session: string, name: string): Promise<void> {
  validateSetupName(name);
  try {
    await unlink(join(setupsDir(project, session), `${name}.json`));
  } catch (err: any) {
    if (err?.code === 'ENOENT') throw new Error(`Setup "${name}" not found`);
    throw err;
  }
}

export function substituteParams(step: SetupStep, params: Record<string, string>): SetupStep {
  return JSON.parse(
    JSON.stringify(step).replace(/\{\{(\w+)\}\}/g, (_, k: string) => params[k] ?? `{{${k}}}`),
  ) as SetupStep;
}

export async function runSetup(
  project: string,
  session: string,
  name: string,
  opts: RunOpts = {},
): Promise<RunResult> {
  const { parameters = {}, start_step = 0, step_timeout_ms = 5000, smart_skip = false } = opts;
  const callChain = opts._callChain ? new Set(opts._callChain) : new Set<string>();

  if (callChain.has(name)) {
    throw new CircularSetupError(`Circular setup reference detected: "${name}" is already in the call chain`);
  }
  if (callChain.size >= 10) {
    throw new CircularSetupError(`Setup call depth limit (10) exceeded`);
  }
  callChain.add(name);

  const setup = await getSetup(project, session, name);

  // Merge default parameter values under caller overrides
  const resolvedParams: Record<string, string> = {};
  for (const p of setup.parameters ?? []) {
    if (p.default !== undefined) resolvedParams[p.name] = p.default;
  }
  Object.assign(resolvedParams, parameters);

  // Smart skip
  if (smart_skip && setup.check) {
    let checkPassed = true;
    if (setup.check.url_contains) {
      try {
        const urlJson = await browserGetUrl(session);
        const { url } = JSON.parse(urlJson) as { url: string };
        if (!url.includes(setup.check.url_contains)) checkPassed = false;
      } catch { checkPassed = false; }
    }
    if (checkPassed && setup.check.selector) {
      try {
        const res = await browserEvaluate(session, `!!document.querySelector(${JSON.stringify(setup.check.selector)})`);
        const parsed = JSON.parse(res) as { value?: boolean };
        if (!parsed.value) checkPassed = false;
      } catch { checkPassed = false; }
    }
    if (checkPassed) {
      return { success: true, skipped: true, stepsRun: 0, durationMs: 0, stepResults: [] };
    }
  }

  const steps = setup.steps.slice(start_step);
  const stepResults: StepResult[] = [];
  const globalStart = Date.now();

  for (let i = 0; i < steps.length; i++) {
    const rawStep = steps[i];
    const step = substituteParams(rawStep, resolvedParams);
    const absIndex = start_step + i;
    const t0 = Date.now();

    try {
      switch (step.action) {
        case 'navigate':
          await browserNavigate(session, step.url);
          break;
        case 'click':
          await browserClick(step.selector, session, step.text);
          break;
        case 'fill':
          await browserFill(step.selector, step.value, session);
          break;
        case 'fill_react':
          await browserFillReact(step.selector, step.value, session);
          break;
        case 'type':
          await browserTypeText(step.text, session);
          break;
        case 'select':
          await browserSelect(step.selector, step.value, session);
          break;
        case 'press_key':
          await browserPressKey(step.key, session);
          break;
        case 'wait':
          await new Promise(r => setTimeout(r, step.ms));
          break;
        case 'wait_for':
          await browserWaitFor(step.selector, undefined, step.timeout ?? step_timeout_ms, session);
          break;
        case 'wait_for_text': {
          const deadline = Date.now() + (step.timeout ?? step_timeout_ms);
          const expr = step.selector
            ? `!!(Array.from(document.querySelectorAll(${JSON.stringify(step.selector)})).find(el => el.textContent?.includes(${JSON.stringify(step.text)})))`
            : `document.body.textContent?.includes(${JSON.stringify(step.text)}) ?? false`;
          let found = false;
          while (Date.now() < deadline) {
            const res = await browserEvaluate(session, expr);
            if ((JSON.parse(res) as { value?: boolean }).value) { found = true; break; }
            await new Promise(r => setTimeout(r, 200));
          }
          if (!found) throw new Error(`wait_for_text: "${step.text}" not found after ${step.timeout ?? step_timeout_ms}ms`);
          break;
        }
        case 'screenshot':
          await browserScreenshot(session, project);
          break;
        case 'eval':
          await browserEvaluate(session, step.eval);
          break;
        case 'run_setup':
          await runSetup(project, session, step.setup, {
            parameters: step.parameters,
            step_timeout_ms,
            _callChain: callChain,
          });
          break;
      }

      stepResults.push({ index: absIndex, action: step.action, label: step.label, status: 'ok', durationMs: Date.now() - t0 });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      stepResults.push({ index: absIndex, action: step.action, label: step.label, status: 'failed', durationMs: Date.now() - t0 });

      let errorUrl = '';
      let errorScreenshot = '';
      try {
        const urlJson = await browserGetUrl(session);
        errorUrl = (JSON.parse(urlJson) as { url: string }).url;
      } catch {}
      try {
        const ssJson = await browserScreenshot(session, project);
        errorScreenshot = (JSON.parse(ssJson) as { saved: string }).saved;
      } catch {}

      return {
        success: false,
        stepsRun: i,
        durationMs: Date.now() - globalStart,
        stepResults,
        error: errorMsg,
        errorStep: absIndex,
        errorUrl,
        errorScreenshot,
      };
    }
  }

  return {
    success: true,
    stepsRun: steps.length,
    durationMs: Date.now() - globalStart,
    stepResults,
  };
}
