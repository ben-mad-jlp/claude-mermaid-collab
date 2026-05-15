import { readInstances, type Instance } from '../src/services/instance-discovery';

export async function whereami(argv: string[]): Promise<void> {
  let all = false;
  let project: string | undefined;
  let session: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') { all = true; continue; }
    if (a === '--project') {
      const v = argv[++i];
      if (v === undefined) {
        process.stderr.write('whereami: --project requires a value\n');
        process.exit(1);
      }
      if (v === '') {
        process.stderr.write('whereami: --project value must be non-empty\n');
        process.exit(1);
      }
      project = v;
      continue;
    }
    if (a.startsWith('--project=')) {
      const v = a.slice('--project='.length);
      if (v === '') {
        process.stderr.write('whereami: --project value must be non-empty\n');
        process.exit(1);
      }
      project = v;
      continue;
    }
    if (a === '--session') {
      const v = argv[++i];
      if (v === undefined) {
        process.stderr.write('whereami: --session requires a value\n');
        process.exit(1);
      }
      if (v === '') {
        process.stderr.write('whereami: --session value must be non-empty\n');
        process.exit(1);
      }
      session = v;
      continue;
    }
    if (a.startsWith('--session=')) {
      const v = a.slice('--session='.length);
      if (v === '') {
        process.stderr.write('whereami: --session value must be non-empty\n');
        process.exit(1);
      }
      session = v;
      continue;
    }
    process.stderr.write(`whereami: unknown arg: ${a}\n`);
    process.stderr.write(`usage: mermaid-collab whereami [--all] [--project <path>] [--session <name>]\n`);
    process.exit(1);
  }

  let instances: Instance[];
  try {
    instances = await readInstances();
  } catch (err) {
    process.stderr.write(`whereami: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
    return;
  }

  const filtered = all
    ? instances
    : instances.filter(i =>
        (!project || i.project === project) &&
        (!session || i.session === session));

  process.stdout.write(JSON.stringify(filtered, null, 2) + '\n');
}
