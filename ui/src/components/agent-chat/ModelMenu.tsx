/**
 * ModelMenu Component
 *
 * Popover for selecting the agent model and effort level for the next turn.
 * Positioned as a fixed portal under the anchor's DOMRect.
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAgentSession } from '../../hooks/useAgentSession';
import type { EffortLevel } from '../../types/agent';

export interface ModelMenuProps {
  sessionId: string;
  currentModel?: string;
  currentEffort?: EffortLevel;
  anchorRect: DOMRect;
  onClose: () => void;
}

const PRESET_MODELS = ['sonnet', 'opus', 'haiku'] as const;
const EFFORT_OPTIONS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export const ModelMenu: React.FC<ModelMenuProps> = ({
  sessionId,
  currentModel,
  currentEffort,
  anchorRect,
  onClose,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { setModel: dispatchSetModel } = useAgentSession(sessionId);

  const initialIsPreset = currentModel != null && (PRESET_MODELS as readonly string[]).includes(currentModel);
  const [model, setModel] = useState<string>(
    currentModel == null ? 'sonnet' : initialIsPreset ? currentModel : 'custom',
  );
  const [customModel, setCustomModel] = useState<string>(
    currentModel != null && !initialIsPreset ? currentModel : '',
  );
  const [effort, setEffort] = useState<EffortLevel>(currentEffort ?? 'medium');

  // Outside click → close
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  // Escape → close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const onApply = () => {
    const chosen = (model === 'custom' ? customModel.trim() : model);
    if (!chosen) return;
    dispatchSetModel(chosen, effort);
    onClose();
  };

  const card = (
    <div
      ref={containerRef}
      data-testid="model-menu"
      className="fixed z-50 rounded-md border bg-popover text-popover-foreground shadow-md p-3 w-64"
      style={{
        top: `${anchorRect.bottom + 6}px`,
        left: `${anchorRect.left}px`,
      }}
    >
      <div className="font-medium text-sm mb-2">Model</div>

      <div className="flex flex-col gap-1 mb-3">
        {PRESET_MODELS.map((m) => (
          <label key={m} className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              name="model"
              value={m}
              checked={model === m}
              onChange={() => setModel(m)}
            />
            <span className="capitalize">{m}</span>
          </label>
        ))}
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="radio"
            name="model"
            value="custom"
            checked={model === 'custom'}
            onChange={() => setModel('custom')}
          />
          <span>Custom</span>
        </label>
        {model === 'custom' && (
          <input
            type="text"
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
            placeholder="model id"
            className="ml-5 mt-1 px-2 py-1 border rounded text-sm bg-background"
          />
        )}
      </div>

      <div className="mb-2">
        <label className="block text-sm mb-1">Effort</label>
        <select
          value={effort}
          onChange={(e) => setEffort(e.target.value as EffortLevel)}
          className="w-full px-2 py-1 border rounded text-sm bg-background"
        >
          {EFFORT_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>

      <p className="text-xs text-muted-foreground mt-2">
        Applies to next turn — current in-flight message unaffected.
      </p>

      <div className="flex items-center justify-end gap-2 mt-3">
        <button
          type="button"
          onClick={onClose}
          className="px-2 py-1 text-sm rounded hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="model-menu-apply"
          onClick={onApply}
          className="px-2 py-1 text-sm rounded bg-primary text-primary-foreground hover:opacity-90"
        >
          Apply
        </button>
      </div>
    </div>
  );

  return createPortal(card, document.body);
};

ModelMenu.displayName = 'ModelMenu';

export default ModelMenu;
