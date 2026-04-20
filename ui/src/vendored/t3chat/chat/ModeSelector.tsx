import * as React from 'react';
import { Settings2 } from 'lucide-react';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../ui/select';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover';
import { Button } from '../ui/button';
import {
  joinModes,
  splitPermissionMode,
  type PermissionMode,
  type RuntimeMode,
  type InteractionMode,
} from '@/types/agent';

export interface ModeSelectorProps {
  runtime: RuntimeMode;
  interaction: InteractionMode;
  onRuntimeChange: (mode: RuntimeMode) => void;
  onInteractionChange: (mode: InteractionMode) => void;
  disabled?: boolean;
}

const PRESET_LABELS: Record<PermissionMode, string> = {
  supervised: 'Supervised',
  'accept-edits': 'Accept Edits',
  plan: 'Plan',
  bypass: 'Bypass',
};

const PRESETS: PermissionMode[] = ['supervised', 'accept-edits', 'plan', 'bypass'];

const RUNTIME_LABELS: Record<RuntimeMode, string> = {
  'read-only': 'Read-only',
  edit: 'Edit',
  bypass: 'Bypass',
};

const INTERACTION_LABELS: Record<InteractionMode, string> = {
  ask: 'Ask',
  'accept-edits': 'Accept Edits',
  plan: 'Plan',
};

const RUNTIME_OPTIONS: RuntimeMode[] = ['read-only', 'edit', 'bypass'];
const INTERACTION_OPTIONS: InteractionMode[] = ['ask', 'accept-edits', 'plan'];

export const ModeSelector: React.FC<ModeSelectorProps> = ({
  runtime,
  interaction,
  onRuntimeChange,
  onInteractionChange,
  disabled,
}) => {
  const preset = joinModes(runtime, interaction);

  const handlePresetChange = (next: PermissionMode) => {
    const split = splitPermissionMode(next);
    onRuntimeChange(split.runtime);
    onInteractionChange(split.interaction);
  };

  return (
    <div className="flex items-center gap-1" data-testid="mode-selector">
      <div className="min-w-[9rem]">
        <Select
          value={preset}
          onValueChange={(v) => handlePresetChange(v as PermissionMode)}
          disabled={disabled}
        >
          <SelectTrigger aria-label="Permission preset" data-testid="mode-preset-trigger">
            <SelectValue>{PRESET_LABELS[preset]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PRESETS.map((p) => (
              <SelectItem key={p} value={p}>
                {PRESET_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Popover>
        <PopoverTrigger
          render={
            <Button
              size="icon"
              variant="ghost"
              aria-label="Advanced mode options"
              data-testid="mode-advanced-trigger"
              disabled={disabled}
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          }
        />
        <PopoverContent
          align="end"
          data-testid="mode-advanced-popover"
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Runtime</label>
              <Select
                value={runtime}
                onValueChange={(v) => onRuntimeChange(v as RuntimeMode)}
                disabled={disabled}
              >
                <SelectTrigger aria-label="Runtime mode" data-testid="mode-runtime-trigger">
                  <SelectValue>{RUNTIME_LABELS[runtime]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {RUNTIME_OPTIONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {RUNTIME_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Interaction</label>
              <Select
                value={interaction}
                onValueChange={(v) => onInteractionChange(v as InteractionMode)}
                disabled={disabled}
              >
                <SelectTrigger aria-label="Interaction mode" data-testid="mode-interaction-trigger">
                  <SelectValue>{INTERACTION_LABELS[interaction]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {INTERACTION_OPTIONS.map((i) => (
                    <SelectItem key={i} value={i}>
                      {INTERACTION_LABELS[i]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};

ModeSelector.displayName = 'ModeSelector';

export default ModeSelector;
