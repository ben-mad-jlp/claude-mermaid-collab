// Browser MCP tool surface — extracted verbatim from setup.ts.
//
// Owns the cohesive BROWSER tool group: the ListTools declarations
// (BROWSER_TOOL_DEFS, sourced from browserToolSchemas) and the CallTool handlers
// (handleBrowserTool). The per-case dynamic `import('./tools/browser.js')` is kept
// verbatim — it lazy-loads the browser/CDP deps so server startup stays lean when
// no browser tool is ever called. Behavior is identical to the inline version.
import { browserToolSchemas } from './tools/browser.js';
import { getWebSocketHandler } from '../services/ws-handler-manager.js';

/**
 * ListTools declarations for the browser tool group. Spread into the ListTools
 * array in setup.ts via `...BROWSER_TOOL_DEFS`.
 */
export const BROWSER_TOOL_DEFS = [
      browserToolSchemas.browser_open,
      browserToolSchemas.browser_navigate,
      browserToolSchemas.browser_evaluate,
      browserToolSchemas.browser_screenshot,
      browserToolSchemas.browser_console,
      browserToolSchemas.browser_network,
      browserToolSchemas.browser_click,
      browserToolSchemas.browser_fill,
      browserToolSchemas.browser_fill_react,
      browserToolSchemas.browser_select,
      browserToolSchemas.browser_press_key,
      browserToolSchemas.browser_hover,
      browserToolSchemas.browser_handle_dialog,
      browserToolSchemas.browser_wait_for,
      browserToolSchemas.browser_get_url,
      browserToolSchemas.browser_drag,
      browserToolSchemas.browser_type_text,
      browserToolSchemas.browser_fill_form,
      browserToolSchemas.browser_emulate,
      browserToolSchemas.browser_resize_page,
      browserToolSchemas.browser_take_snapshot,
      browserToolSchemas.browser_take_memory_snapshot,
      browserToolSchemas.browser_upload_file,
      browserToolSchemas.browser_lighthouse_audit,
      browserToolSchemas.browser_performance_analyze_insight,
      browserToolSchemas.browser_save_setup,
      browserToolSchemas.browser_get_setup,
      browserToolSchemas.browser_list_setups,
      browserToolSchemas.browser_run_setup,
      browserToolSchemas.browser_delete_setup,
];

/**
 * Handle a browser-group CallTool invocation. Returns the JSON string result
 * (identical to the original inline setup.ts handler), or `null` if `name` is
 * not a browser tool — in which case the caller falls through to its own switch.
 */
export async function handleBrowserTool(name: string, args: any): Promise<string | null> {
  switch (name) {
    case 'browser_open': {
      const { url, session } = args as { url: string; session: string };
      if (!session) throw new Error('browser_open requires session');
      if (!url) throw new Error('Missing required: url');
      const { browserOpen } = await import('./tools/browser.js');
      const result = await browserOpen(url, session);
      try {
        getWebSocketHandler()?.broadcastBrowserTabUpdate(session, true);
      } catch {}
      return result;
    }

    case 'browser_navigate': {
      const { session, url } = args as { session: string; url: string };
      if (!session) throw new Error('browser_navigate requires session');
      if (!url) throw new Error('Missing required: url');
      const { browserNavigate } = await import('./tools/browser.js');
      return await browserNavigate(session, url);
    }

    case 'browser_evaluate': {
      const { session, expression } = args as { session: string; expression: string };
      if (!session) throw new Error('browser_evaluate requires session');
      if (!expression) throw new Error('Missing required: expression');
      const { browserEvaluate } = await import('./tools/browser.js');
      return await browserEvaluate(session, expression);
    }

    case 'browser_screenshot': {
      const { session, project } = args as { session: string; project: string };
      if (!session) throw new Error('browser_screenshot requires session');
      if (!project || !session) throw new Error('Missing required: project, session');
      const { browserScreenshot } = await import('./tools/browser.js');
      return await browserScreenshot(session, project);
    }

    case 'browser_console': {
      const { session } = args as { session: string };
      if (!session) throw new Error('browser_console requires session');
      const { browserConsole } = await import('./tools/browser.js');
      return await browserConsole(session);
    }

    case 'browser_network': {
      const { session } = args as { session: string };
      if (!session) throw new Error('browser_network requires session');
      const { browserNetwork } = await import('./tools/browser.js');
      return await browserNetwork(session);
    }

    case 'browser_click': {
      const { selector, session, text } = args as { selector: string; session: string; text?: string };
      if (!session) throw new Error('browser_click requires session');
      const { browserClick } = await import('./tools/browser.js');
      return await browserClick(selector, session, text);
    }

    case 'browser_fill': {
      const { selector, value, session } = args as { selector: string; value: string; session: string };
      if (!session) throw new Error('browser_fill requires session');
      const { browserFill } = await import('./tools/browser.js');
      return await browserFill(selector, value, session);
    }

    case 'browser_fill_react': {
      const { selector, value, session } = args as { selector: string; value: string; session: string };
      if (!session) throw new Error('browser_fill_react requires session');
      const { browserFillReact } = await import('./tools/browser.js');
      return await browserFillReact(selector, value, session);
    }

    case 'browser_select': {
      const { selector, value, session } = args as { selector: string; value: string; session: string };
      if (!session) throw new Error('browser_select requires session');
      const { browserSelect } = await import('./tools/browser.js');
      return await browserSelect(selector, value, session);
    }

    case 'browser_press_key': {
      const { key, session } = args as { key: string; session: string };
      if (!session) throw new Error('browser_press_key requires session');
      const { browserPressKey } = await import('./tools/browser.js');
      return await browserPressKey(key, session);
    }

    case 'browser_hover': {
      const { selector, session } = args as { selector: string; session: string };
      if (!session) throw new Error('browser_hover requires session');
      const { browserHover } = await import('./tools/browser.js');
      return await browserHover(selector, session);
    }

    case 'browser_handle_dialog': {
      const { accept, promptText, session } = args as { accept: boolean; promptText?: string; session: string };
      if (!session) throw new Error('browser_handle_dialog requires session');
      const { browserHandleDialog } = await import('./tools/browser.js');
      return await browserHandleDialog(accept, session, promptText);
    }

    case 'browser_wait_for': {
      const { selector, navigation, timeout, session } = args as { selector?: string; navigation?: boolean; timeout?: number; session: string };
      if (!session) throw new Error('browser_wait_for requires session');
      const { browserWaitFor } = await import('./tools/browser.js');
      return await browserWaitFor(selector, navigation, timeout, session);
    }

    case 'browser_get_url': {
      const { session } = args as { session: string };
      if (!session) throw new Error('browser_get_url requires session');
      const { browserGetUrl } = await import('./tools/browser.js');
      return await browserGetUrl(session);
    }

    case 'browser_drag': {
      const { sourceSelector, targetSelector, session } = args as { sourceSelector: string; targetSelector: string; session: string };
      if (!session) throw new Error('browser_drag requires session');
      const { browserDrag } = await import('./tools/browser.js');
      return await browserDrag(sourceSelector, targetSelector, session);
    }

    case 'browser_type_text': {
      const { text, session } = args as { text: string; session: string };
      if (!session) throw new Error('browser_type_text requires session');
      const { browserTypeText } = await import('./tools/browser.js');
      return await browserTypeText(text, session);
    }

    case 'browser_fill_form': {
      const { fields, session } = args as { fields: Record<string, string>; session: string };
      if (!session) throw new Error('browser_fill_form requires session');
      const { browserFillForm } = await import('./tools/browser.js');
      return await browserFillForm(fields, session);
    }

    case 'browser_emulate': {
      const { device, width, height, mobile, session } = args as { device?: string; width?: number; height?: number; mobile?: boolean; session: string };
      if (!session) throw new Error('browser_emulate requires session');
      const { browserEmulate } = await import('./tools/browser.js');
      return await browserEmulate(device, width, height, mobile, session);
    }

    case 'browser_resize_page': {
      const { width, height, session } = args as { width: number; height: number; session: string };
      if (!session) throw new Error('browser_resize_page requires session');
      const { browserResizePage } = await import('./tools/browser.js');
      return await browserResizePage(width, height, session);
    }

    case 'browser_take_snapshot': {
      const { session } = args as { session: string };
      if (!session) throw new Error('browser_take_snapshot requires session');
      const { browserTakeSnapshot } = await import('./tools/browser.js');
      return await browserTakeSnapshot(session);
    }

    case 'browser_take_memory_snapshot': {
      const { session } = args as { session: string };
      if (!session) throw new Error('browser_take_memory_snapshot requires session');
      const { browserTakeMemorySnapshot } = await import('./tools/browser.js');
      return await browserTakeMemorySnapshot(session);
    }

    case 'browser_upload_file': {
      const { selector, filePath, session } = args as { selector: string; filePath: string; session: string };
      if (!session) throw new Error('browser_upload_file requires session');
      const { browserUploadFile } = await import('./tools/browser.js');
      return await browserUploadFile(selector, filePath, session);
    }

    case 'browser_lighthouse_audit': {
      const { url, session } = args as { url?: string; session: string };
      if (!session) throw new Error('browser_lighthouse_audit requires session');
      const { browserLighthouseAudit } = await import('./tools/browser.js');
      return await browserLighthouseAudit(url, session);
    }

    case 'browser_performance_analyze_insight': {
      const { session } = args as { session: string };
      if (!session) throw new Error('browser_performance_analyze_insight requires session');
      const { browserPerformanceAnalyzeInsight } = await import('./tools/browser.js');
      return await browserPerformanceAnalyzeInsight(session);
    }

    case 'browser_save_setup': {
      const { session, project, name, steps, description, parameters, check } = args as { session: string; project: string; name: string; steps: any[]; description?: string; parameters?: any[]; check?: any };
      if (!session) throw new Error('browser_save_setup requires session');
      const { browserSaveSetup } = await import('./tools/browser.js');
      return await browserSaveSetup(session, project, name, steps, description, parameters, check);
    }
    case 'browser_get_setup': {
      const { session, project, name } = args as { session: string; project: string; name: string };
      if (!session) throw new Error('browser_get_setup requires session');
      const { browserGetSetup } = await import('./tools/browser.js');
      return await browserGetSetup(session, project, name);
    }
    case 'browser_list_setups': {
      const { session, project } = args as { session: string; project: string };
      if (!session) throw new Error('browser_list_setups requires session');
      const { browserListSetups } = await import('./tools/browser.js');
      return await browserListSetups(session, project);
    }
    case 'browser_run_setup': {
      const { session, project, name, parameters, start_step, step_timeout_ms, smart_skip } = args as { session: string; project: string; name: string; parameters?: Record<string,string>; start_step?: number; step_timeout_ms?: number; smart_skip?: boolean };
      if (!session) throw new Error('browser_run_setup requires session');
      const { browserRunSetup } = await import('./tools/browser.js');
      return await browserRunSetup(session, project, name, parameters, start_step, step_timeout_ms, smart_skip);
    }
    case 'browser_delete_setup': {
      const { session, project, name } = args as { session: string; project: string; name: string };
      if (!session) throw new Error('browser_delete_setup requires session');
      const { browserDeleteSetup } = await import('./tools/browser.js');
      return await browserDeleteSetup(session, project, name);
    }

    default:
      return null;
  }
}
