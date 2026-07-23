import { describe, it, expect, beforeEach, mock } from 'bun:test';
import type { ManifestSource, ProjectManifest } from '../../config/project-manifest';

const createEscalationCalls: Array<{
  project: string;
  session: string;
  kind: string;
  operatorGated: boolean;
  todoId: string;
  questionText: string;
}> = [];

mock.module('../supervisor-store', () => ({
  createEscalation: (input: any) => {
    createEscalationCalls.push(input);
  },
  resolveEscalation: () => {},
}));

// Must import after mocking supervisor-store
import { escalateLegacyGateResidual } from '../leaf-executor';
import { resolveGateDeclaration } from '../leaf-gate';

const mockTodo = (id: string): { id: string } => ({ id });

describe('escalateLegacyGateResidual', () => {
  beforeEach(() => {
    createEscalationCalls.length = 0;
  });

  it('escalates once per targetProject when changeSetTestCwd is set without changeSetTestCommand', () => {
    const manifestSource: ManifestSource = {
      state: 'ok',
      path: '/project/.collab/project.json',
      manifest: {
        changeSetTestCwd: 'ui',
        // no changeSetTestCommand — leaves the gate absent
      } as ProjectManifest,
    };

    // Verify the manifest yields kind==='absent'
    const gateDecl = resolveGateDeclaration(manifestSource);
    expect(gateDecl.kind).toBe('absent');

    // First call
    const leaf1 = mockTodo('leaf-1');
    escalateLegacyGateResidual('proj', 'target-a', leaf1, manifestSource);
    expect(createEscalationCalls.length).toBe(1);
    expect(createEscalationCalls[0]!.session).toContain('legacy-gate-migration::target-a');

    // Second call with different leaf id, same targetProject — should NOT escalate again
    const leaf2 = mockTodo('leaf-2');
    escalateLegacyGateResidual('proj', 'target-a', leaf2, manifestSource);
    expect(createEscalationCalls.length).toBe(1);
  });

  it('escalates once per targetProject when frontendBaselineFailures is set', () => {
    const manifestSource: ManifestSource = {
      state: 'ok',
      path: '/project/.collab/project.json',
      manifest: {
        frontendBaselineFailures: ['flaky.spec', 'slow.test'],
        // no frontendGateCommand — leaves the gate absent
      } as ProjectManifest,
    };

    // Verify the manifest yields kind==='absent'
    const gateDecl = resolveGateDeclaration(manifestSource);
    expect(gateDecl.kind).toBe('absent');

    // First call
    const leaf1 = mockTodo('leaf-3');
    escalateLegacyGateResidual('proj', 'target-b', leaf1, manifestSource);
    expect(createEscalationCalls.length).toBe(1);
    expect(createEscalationCalls[0]!.session).toContain('legacy-gate-migration::target-b');

    // Second call with different leaf id, same targetProject — should NOT escalate again
    const leaf2 = mockTodo('leaf-4');
    escalateLegacyGateResidual('proj', 'target-b', leaf2, manifestSource);
    expect(createEscalationCalls.length).toBe(1);
  });

  it('does not escalate when manifest is fully bridged (gateCommand + frontendGateCommand)', () => {
    const manifestSource: ManifestSource = {
      state: 'ok',
      path: '/project/.collab/project.json',
      manifest: {
        gateCommand: 'pytest',
        frontendGateCommand: 'vitest run',
      } as ProjectManifest,
    };

    // Verify the manifest yields kind==='declared' (bridge succeeds)
    // This proves a fully-bridged manifest never reaches the absent arm where
    // escalateLegacyGateResidual would be called
    const gateDecl = resolveGateDeclaration(manifestSource);
    expect(gateDecl.kind).toBe('declared');
  });

  it('does not escalate when manifest is null', () => {
    const manifestSource: ManifestSource = {
      state: 'ok',
      path: '/project/.collab/project.json',
      manifest: null,
    };

    const leaf = mockTodo('leaf-6');
    escalateLegacyGateResidual('proj', 'target-d', leaf, manifestSource);
    expect(createEscalationCalls.length).toBe(0);
  });

  it('does not escalate when no legacy keys are present', () => {
    const manifestSource: ManifestSource = {
      state: 'ok',
      path: '/project/.collab/project.json',
      manifest: {
        version: 1,
        profiles: {},
        // no legacy gate keys
      } as ProjectManifest,
    };

    // Verify this yields kind==='absent'
    const gateDecl = resolveGateDeclaration(manifestSource);
    expect(gateDecl.kind).toBe('absent');

    // But escalation should not fire (no residual keys found)
    const leaf = mockTodo('leaf-7');
    escalateLegacyGateResidual('proj', 'target-e', leaf, manifestSource);
    expect(createEscalationCalls.length).toBe(0);
  });

  it('escalation includes the key names and path in the question text', () => {
    const manifestSource: ManifestSource = {
      state: 'ok',
      path: '/project/.collab/project.json',
      manifest: {
        changeSetTestCwd: 'ui',
        frontendBaselineFailures: ['test.spec'],
      } as ProjectManifest,
    };

    const leaf = mockTodo('leaf-8');
    escalateLegacyGateResidual('proj', 'my-project', leaf, manifestSource);

    expect(createEscalationCalls.length).toBe(1);
    const call = createEscalationCalls[0]!;
    expect(call.questionText).toContain('changeSetTestCwd');
    expect(call.questionText).toContain('frontendBaselineFailures');
    expect(call.questionText).toContain('/project/.collab/project.json');
    expect(call.questionText).toContain('my-project');
    expect(call.operatorGated).toBe(true);
    expect(call.kind).toBe('operator-gated');
  });
});
