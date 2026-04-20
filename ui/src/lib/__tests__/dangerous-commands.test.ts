import { describe, it, expect } from 'vitest';
import { detectDanger } from '../dangerous-commands';

describe('detectDanger', () => {
  it('returns not dangerous for empty string', () => {
    expect(detectDanger('')).toEqual({ dangerous: false });
  });

  it('returns not dangerous for null/undefined input without throwing', () => {
    expect(() => detectDanger(null as unknown as string)).not.toThrow();
    expect(() => detectDanger(undefined as unknown as string)).not.toThrow();
    expect(detectDanger(null as unknown as string)).toEqual({ dangerous: false });
    expect(detectDanger(undefined as unknown as string)).toEqual({ dangerous: false });
  });

  it('detects rm -rf', () => {
    const result = detectDanger('rm -rf /tmp/foo');
    expect(result.dangerous).toBe(true);
    expect(result.reason).toMatch(/rm/i);
  });

  it('detects git push --force', () => {
    expect(detectDanger('git push --force origin main').dangerous).toBe(true);
  });

  it('detects git push -f', () => {
    expect(detectDanger('git push -f').dangerous).toBe(true);
  });

  it('detects SQL DROP statements case-insensitively', () => {
    expect(detectDanger('DROP TABLE users').dangerous).toBe(true);
    expect(detectDanger('drop database prod').dangerous).toBe(true);
    expect(detectDanger('Drop Schema x').dangerous).toBe(true);
  });

  it('detects kubectl delete', () => {
    expect(detectDanger('kubectl delete pod foo').dangerous).toBe(true);
  });

  it('detects terraform destroy', () => {
    expect(detectDanger('terraform destroy -auto-approve').dangerous).toBe(true);
  });

  it('does not flag benign commands', () => {
    expect(detectDanger('ls -la')).toEqual({ dangerous: false });
    expect(detectDanger('git push origin main')).toEqual({ dangerous: false });
    expect(detectDanger('rm file.txt')).toEqual({ dangerous: false });
    expect(detectDanger('kubectl get pods')).toEqual({ dangerous: false });
    expect(detectDanger('terraform plan')).toEqual({ dangerous: false });
  });

  it('returns the first matching reason when multiple patterns could match', () => {
    // rm -rf comes before git push --force in the pattern list
    const result = detectDanger('rm -rf / && git push --force');
    expect(result.dangerous).toBe(true);
    expect(result.reason).toMatch(/rm -rf/i);
  });
});
