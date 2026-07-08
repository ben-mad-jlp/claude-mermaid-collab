// Spreadsheet MCP tool surface — extracted verbatim from setup.ts.
//
// Owns the cohesive SPREADSHEET tool group: the ListTools declarations
// (SPREADSHEET_TOOL_DEFS), the CallTool handlers (handleSpreadsheetTool), and the
// spreadsheet helper functions that were local to setup.ts. listSpreadsheets is
// exported because setup.ts still calls it from other flows (session summary /
// clear-artifacts); the module imports only leaf services, so no import cycle.
// Behavior is identical — a pure move.
import { buildUrl, asJson, sessionParamsDesc } from './tools/http-util.js';
import { sessionRegistry } from '../services/session-registry.js';
import { projectRegistry } from '../services/project-registry.js';

// ---------------------------------------------------------------------------
// Spreadsheet helpers (were inline in setup.ts; exported for setup.ts callers)
// ---------------------------------------------------------------------------

export async function listSpreadsheets(project: string, session: string): Promise<string> {
  const response = await fetch(buildUrl('/api/spreadsheets', project, session));
  if (!response.ok) {
    throw new Error(`Failed to list spreadsheets: ${response.statusText}`);
  }
  const data = await asJson(response);
  return JSON.stringify(data, null, 2);
}

export async function getSpreadsheet(project: string, session: string, id: string): Promise<string> {
  const response = await fetch(buildUrl(`/api/spreadsheet/${id}`, project, session));
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Spreadsheet not found: ${id}`);
    }
    throw new Error(`Failed to get spreadsheet: ${response.statusText}`);
  }
  const data = await asJson(response);
  return JSON.stringify(data, null, 2);
}

export async function createSpreadsheet(project: string, session: string, name: string, content: string): Promise<string> {
  const response = await fetch(buildUrl('/api/spreadsheet', project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content }),
  });
  if (!response.ok) {
    const error = await asJson(response);
    throw new Error(`Failed to create spreadsheet: ${error.error || response.statusText}`);
  }
  const data = await asJson(response);
  return JSON.stringify({
    success: true,
    id: data.id,
    message: 'Spreadsheet created successfully',
  }, null, 2);
}

export async function updateSpreadsheet(project: string, session: string, id: string, content: string): Promise<string> {
  const response = await fetch(buildUrl(`/api/spreadsheet/${id}`, project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) {
    const error = await asJson(response);
    throw new Error(`Failed to update spreadsheet: ${error.error || response.statusText}`);
  }
  return JSON.stringify({ success: true, id, message: 'Spreadsheet updated successfully' }, null, 2);
}

// ---------------------------------------------------------------------------
// ListTools declarations — spread into setup.ts via `...SPREADSHEET_TOOL_DEFS`.
// ---------------------------------------------------------------------------

export const SPREADSHEET_TOOL_DEFS = [
      {
        name: 'list_spreadsheets',
        description: 'List all spreadsheets in a session.',
        inputSchema: {
          type: 'object',
          properties: sessionParamsDesc,
          required: ['project'],
        },
      },
      {
        name: 'get_spreadsheet',
        description: 'Read a spreadsheet\'s content by ID.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'The spreadsheet ID' },
          },
          required: ['project', 'id'],
        },
      },
      {
        name: 'create_spreadsheet',
        description: 'Create a new spreadsheet with columns and rows. Columns have types: text, number, boolean, date. Rows use column names as keys.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            name: { type: 'string', description: 'Spreadsheet name' },
            columns: {
              type: 'array',
              description: 'Column definitions',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Column header label' },
                  type: { type: 'string', enum: ['text', 'number', 'boolean', 'date'], description: 'Data type' },
                  width: { type: 'number', description: 'Column width in pixels (optional)' },
                },
                required: ['name', 'type'],
              },
            },
            rows: {
              type: 'array',
              description: 'Row data as objects with column names as keys',
              items: {
                type: 'object',
                additionalProperties: true,
              },
            },
          },
          required: ['project', 'name', 'columns'],
        },
      },
      {
        name: 'update_spreadsheet',
        description: 'Replace a spreadsheet\'s entire content with new JSON data.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'The spreadsheet ID' },
            content: { type: 'string', description: 'Full SpreadsheetData JSON string' },
          },
          required: ['project', 'id', 'content'],
        },
      },
      {
        name: 'delete_spreadsheet',
        description: 'Delete a spreadsheet by ID.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'Spreadsheet ID' },
          },
          required: ['project', 'id'],
        },
      },
      {
        name: 'get_spreadsheet_history',
        description: 'Get the change history for a spreadsheet.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'Spreadsheet ID' },
          },
          required: ['project', 'id'],
        },
      },
      {
        name: 'revert_spreadsheet',
        description: 'Revert a spreadsheet to a specific historical version by timestamp.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'Spreadsheet ID' },
            timestamp: { type: 'string', description: 'ISO timestamp of the version to revert to' },
          },
          required: ['project', 'id', 'timestamp'],
        },
      },
      {
        name: 'patch_spreadsheet',
        description: 'Apply incremental edits to a spreadsheet without replacing the entire content. Supports add/update/delete rows, add/delete/rename columns, and set aggregates.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'Spreadsheet ID' },
            operations: {
              type: 'array',
              description: 'List of operations to apply',
              items: {
                type: 'object',
                properties: {
                  op: {
                    type: 'string',
                    enum: ['add_row', 'update_row', 'delete_row', 'add_column', 'delete_column', 'rename_column', 'set_aggregate'],
                    description: 'Operation type',
                  },
                  rowId: { type: 'string', description: 'Row ID (for update_row, delete_row)' },
                  cells: { type: 'object', additionalProperties: true, description: 'Cell values keyed by column name (for add_row, update_row)' },
                  columnId: { type: 'string', description: 'Column ID (for delete_column, rename_column, set_aggregate)' },
                  name: { type: 'string', description: 'Column name (for add_column, rename_column)' },
                  type: { type: 'string', enum: ['text', 'number', 'boolean', 'date'], description: 'Column type (for add_column)' },
                  defaultValue: { description: 'Default value for new column cells' },
                  function: { type: 'string', enum: ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'], description: 'Aggregate function (for set_aggregate)' },
                },
                required: ['op'],
              },
            },
          },
          required: ['project', 'id', 'operations'],
        },
      },
      {
        name: 'export_spreadsheet_csv',
        description: 'Export a spreadsheet as CSV text.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'Spreadsheet ID' },
          },
          required: ['project', 'id'],
        },
      },
];

/**
 * Handle a spreadsheet-group CallTool invocation. Returns the JSON string result
 * (identical to the original inline setup.ts handler), or `null` if `name` is not
 * a spreadsheet tool — in which case the caller falls through to its own switch.
 */
export async function handleSpreadsheetTool(name: string, args: any): Promise<string | null> {
  switch (name) {
    case 'list_spreadsheets': {
      const { project, session } = args as { project: string; session: string };
      if (!project || !session) throw new Error('Missing required: project, session');
      return await listSpreadsheets(project, session);
    }

    case 'get_spreadsheet': {
      const { project, session, id } = args as { project: string; session: string; id: string };
      if (!project || !session || !id) throw new Error('Missing required: project, session, id');
      return await getSpreadsheet(project, session, id);
    }

    case 'create_spreadsheet': {
      const { project, session, name: sName, columns, rows } = args as {
        project: string; session: string; name: string;
        columns: Array<{ name: string; type: string; width?: number }>;
        rows?: Array<Record<string, any>>;
      };
      if (!project || !session || !sName || !columns) throw new Error('Missing required: project, session, name, columns');

      // Build SpreadsheetData JSON
      const colDefs = columns.map(col => ({
        id: `col_${col.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`,
        name: col.name,
        type: col.type,
        ...(col.width ? { width: col.width } : {}),
      }));

      // Build name→id map
      const nameToId: Record<string, string> = {};
      for (const col of colDefs) {
        nameToId[col.name] = col.id;
      }

      const rowDefs = (rows || []).map((row, i) => {
        const cells: Record<string, any> = {};
        for (const [key, value] of Object.entries(row)) {
          const colId = nameToId[key];
          if (colId) {
            cells[colId] = value;
          }
        }
        return { id: `row_${i + 1}`, cells };
      });

      const spreadsheetData = JSON.stringify({ columns: colDefs, rows: rowDefs }, null, 2);

      // Register session and project if not already registered
      await sessionRegistry.register(project, session);
      await projectRegistry.register(project);

      return await createSpreadsheet(project, session, sName, spreadsheetData);
    }

    case 'update_spreadsheet': {
      const { project, session, id, content } = args as { project: string; session: string; id: string; content: string };
      if (!project || !session || !id || !content) throw new Error('Missing required: project, session, id, content');
      return await updateSpreadsheet(project, session, id, content);
    }

    case 'delete_spreadsheet': {
      const { project, session, id } = args as { project: string; session: string; id: string };
      if (!project || !session || !id) throw new Error('Missing required: project, session, id');
      const response = await fetch(buildUrl(`/api/spreadsheet/${id}`, project, session), {
        method: 'DELETE',
      });
      if (!response.ok) {
        const error = await response.json() as { error?: string };
        throw new Error(`Failed to delete spreadsheet: ${error.error || response.statusText}`);
      }
      return JSON.stringify({ success: true, id, message: 'Spreadsheet deleted' }, null, 2);
    }

    case 'get_spreadsheet_history': {
      const { project, session, id } = args as { project: string; session: string; id: string };
      if (!project || !session || !id) throw new Error('Missing required: project, session, id');
      const response = await fetch(buildUrl(`/api/spreadsheet/${id}/history`, project, session));
      if (!response.ok) {
        if (response.status === 404) {
          return JSON.stringify({ error: 'No history for spreadsheet', history: null }, null, 2);
        }
        throw new Error(`Failed to get spreadsheet history: ${response.statusText}`);
      }
      const data = await asJson(response);
      return JSON.stringify(data, null, 2);
    }

    case 'revert_spreadsheet': {
      const { project, session, id, timestamp } = args as { project: string; session: string; id: string; timestamp: string };
      if (!project || !session || !id || !timestamp) throw new Error('Missing required: project, session, id, timestamp');
      const versionResponse = await fetch(buildUrl(`/api/spreadsheet/${id}/version`, project, session, { timestamp }));
      if (!versionResponse.ok) {
        throw new Error(`Failed to get spreadsheet version: ${versionResponse.statusText}`);
      }
      const versionData = await versionResponse.json() as { content: string };
      const updateResponse = await fetch(buildUrl(`/api/spreadsheet/${id}`, project, session), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: versionData.content }),
      });
      if (!updateResponse.ok) {
        const error = await updateResponse.json() as { error?: string };
        throw new Error(`Failed to revert spreadsheet: ${error.error || updateResponse.statusText}`);
      }
      return JSON.stringify({
        success: true,
        id,
        revertedTo: timestamp,
        message: `Spreadsheet reverted to version from ${timestamp}`,
      }, null, 2);
    }

    case 'patch_spreadsheet': {
      const { project, session, id, operations } = args as {
        project: string; session: string; id: string;
        operations: Array<{
          op: string;
          rowId?: string;
          cells?: Record<string, any>;
          columnId?: string;
          name?: string;
          type?: string;
          defaultValue?: any;
          function?: string;
        }>;
      };
      if (!project || !session || !id || !operations) throw new Error('Missing required: project, session, id, operations');

      // Get current spreadsheet
      const getResp = await fetch(buildUrl(`/api/spreadsheet/${id}`, project, session));
      if (!getResp.ok) {
        throw new Error(`Spreadsheet not found: ${id}`);
      }
      const ssData = await asJson(getResp);
      const data = JSON.parse(ssData.content) as {
        columns: Array<{ id: string; name: string; type: string; width?: number }>;
        rows: Array<{ id: string; cells: Record<string, any> }>;
        aggregates?: Record<string, string>;
      };

      // Build name→id map
      const colNameToId: Record<string, string> = {};
      for (const col of data.columns) {
        colNameToId[col.name] = col.id;
      }

      // Apply operations
      for (const op of operations) {
        switch (op.op) {
          case 'add_row': {
            const cells: Record<string, any> = {};
            if (op.cells) {
              for (const [key, value] of Object.entries(op.cells)) {
                const colId = colNameToId[key] || key;
                cells[colId] = value;
              }
            }
            data.rows.push({ id: `row_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, cells });
            break;
          }
          case 'update_row': {
            const row = data.rows.find(r => r.id === op.rowId);
            if (!row) throw new Error(`Row not found: ${op.rowId}`);
            if (op.cells) {
              for (const [key, value] of Object.entries(op.cells)) {
                const colId = colNameToId[key] || key;
                row.cells[colId] = value;
              }
            }
            break;
          }
          case 'delete_row': {
            const idx = data.rows.findIndex(r => r.id === op.rowId);
            if (idx === -1) throw new Error(`Row not found: ${op.rowId}`);
            data.rows.splice(idx, 1);
            break;
          }
          case 'add_column': {
            if (!op.name || !op.type) throw new Error('add_column requires name and type');
            const newColId = `col_${op.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;
            data.columns.push({ id: newColId, name: op.name, type: op.type });
            colNameToId[op.name] = newColId;
            // Set default value for existing rows
            if (op.defaultValue !== undefined) {
              for (const row of data.rows) {
                row.cells[newColId] = op.defaultValue;
              }
            }
            break;
          }
          case 'delete_column': {
            if (!op.columnId) throw new Error('delete_column requires columnId');
            data.columns = data.columns.filter(c => c.id !== op.columnId);
            for (const row of data.rows) {
              delete row.cells[op.columnId];
            }
            if (data.aggregates) {
              delete data.aggregates[op.columnId];
            }
            break;
          }
          case 'rename_column': {
            if (!op.columnId || !op.name) throw new Error('rename_column requires columnId and name');
            const col = data.columns.find(c => c.id === op.columnId);
            if (!col) throw new Error(`Column not found: ${op.columnId}`);
            delete colNameToId[col.name];
            col.name = op.name;
            colNameToId[op.name] = col.id;
            break;
          }
          case 'set_aggregate': {
            if (!op.columnId || !op.function) throw new Error('set_aggregate requires columnId and function');
            if (!data.aggregates) data.aggregates = {};
            data.aggregates[op.columnId] = op.function;
            break;
          }
          default:
            throw new Error(`Unknown operation: ${op.op}`);
        }
      }

      const newContent = JSON.stringify(data, null, 2);
      return await updateSpreadsheet(project, session, id, newContent);
    }

    case 'export_spreadsheet_csv': {
      const { project, session, id } = args as { project: string; session: string; id: string };
      if (!project || !session || !id) throw new Error('Missing required: project, session, id');

      const getResp = await fetch(buildUrl(`/api/spreadsheet/${id}`, project, session));
      if (!getResp.ok) {
        throw new Error(`Spreadsheet not found: ${id}`);
      }
      const ssData = await asJson(getResp);
      const data = JSON.parse(ssData.content) as {
        columns: Array<{ id: string; name: string; type: string }>;
        rows: Array<{ id: string; cells: Record<string, any> }>;
      };

      // Build CSV
      const escapeCsv = (val: any): string => {
        if (val === null || val === undefined) return '';
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const header = data.columns.map(c => escapeCsv(c.name)).join(',');
      const rows = data.rows.map(row =>
        data.columns.map(col => escapeCsv(row.cells[col.id])).join(',')
      );

      const csv = [header, ...rows].join('\n');
      return JSON.stringify({ success: true, id, csv }, null, 2);
    }

    default:
      return null;
  }
}
