import { describe, it, expect, beforeAll } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { neuterSymbol, throwProbeSymbol } from "../mutation-probe-rewrite";

describe("mutation-probe-rewrite", () => {
  let observedSubjectSource: string;
  let neverCalledSubjectSource: string;

  beforeAll(() => {
    observedSubjectSource = readFileSync(
      join(
        import.meta.dir,
        "../__fixtures__/mutation-probe/observed-subject.ts"
      ),
      "utf-8"
    );
    neverCalledSubjectSource = readFileSync(
      join(
        import.meta.dir,
        "../__fixtures__/mutation-probe/never-called-subject.ts"
      ),
      "utf-8"
    );
  });

  it("neuterSymbol removes the distinctive body statement and reports applied", () => {
    const result = neuterSymbol(observedSubjectSource, "observedSubject");

    expect(result.applied).toBe(true);
    expect(result.source).not.toContain("n * 2 + 10");
    expect(result.source).toContain("return undefined as any");
  });

  it("throwProbeSymbol emits the marker append before the MUTATION_PROBE throw", () => {
    const result = throwProbeSymbol(observedSubjectSource, "observedSubject");

    expect(result.applied).toBe(true);
    expect(result.source).toContain("appendFileSync");
    expect(result.source).toContain("MUTATION_PROBE:");
    expect(result.source).toContain("observedSubject");

    // Check ordering: marker call should come before throw statement
    const markerIdx = result.source.indexOf("appendFileSync");
    const throwIdx = result.source.indexOf("throw new Error");
    expect(markerIdx).toBeLessThan(throwIdx);
  });

  it("an unknown symbol yields applied false with a reason naming it and byte-identical source", () => {
    const result = neuterSymbol(observedSubjectSource, "doesNotExist");

    expect(result.applied).toBe(false);
    expect(result.reason).toContain("doesNotExist");
    expect(result.source).toBe(observedSubjectSource);
  });

  // 60s, not the 5s default: this is the only test here that does two dynamic
  // import()s of freshly-written TypeScript, so it pays for two transpiles and
  // blows the default whenever the box is under land-gate fan-out load.
  it("both rewritten variants of a real fixture subject still import successfully", async () => {
    // Test neuterSymbol parse check
    const neutered = neuterSymbol(neverCalledSubjectSource, "neverCalledSubject");
    expect(neutered.applied).toBe(true);

    const tmpDir = mkdtempSync(join(tmpdir(), "mutation-probe-parse-"));
    try {
      const neuteredPath = join(tmpDir, "neutered.ts");
      writeFileSync(neuteredPath, neutered.source);

      // Import should succeed without throwing
      const neuteredMod = await import(pathToFileURL(neuteredPath).href);
      expect(neuteredMod).toBeDefined();
      expect(neuteredMod.neverCalledSubject).toBeDefined();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }

    // Test throwProbeSymbol parse check
    const thrownProbe = throwProbeSymbol(
      neverCalledSubjectSource,
      "neverCalledSubject"
    );
    expect(thrownProbe.applied).toBe(true);

    const tmpDir2 = mkdtempSync(join(tmpdir(), "mutation-probe-parse-"));
    try {
      const probePath = join(tmpDir2, "probe.ts");
      writeFileSync(probePath, thrownProbe.source);

      // Import should succeed (but calling the function would throw)
      const probeMod = await import(pathToFileURL(probePath).href);
      expect(probeMod).toBeDefined();
      expect(probeMod.neverCalledSubject).toBeDefined();
      // Do not call the function; just verify the module loads
    } finally {
      rmSync(tmpDir2, { recursive: true, force: true });
    }
  }, 60_000);
});
