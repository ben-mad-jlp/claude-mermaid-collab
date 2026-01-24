import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface DbConfig {
  path: string; // Path to codex.db
}

/**
 * Initialize the database connection and ensure tables exist.
 * Creates the database file and parent directories if they don't exist.
 */
export function initDatabase(config: DbConfig): Database.Database {
  // Ensure parent directory exists
  const dbDir = dirname(config.path);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  // Create/open database with better-sqlite3
  const db = new Database(config.path);

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Run migrations to ensure schema is up to date
  runMigrations(db);

  return db;
}

/**
 * Run database migrations to create or update schema.
 * Currently runs the full schema.sql - future versions may support incremental migrations.
 */
export function runMigrations(db: Database.Database): void {
  // Read schema.sql from the same directory
  const schemaPath = join(__dirname, 'schema.sql');

  if (!existsSync(schemaPath)) {
    throw new Error(`Schema file not found: ${schemaPath}`);
  }

  const schema = readFileSync(schemaPath, 'utf-8');

  // Execute the schema (all statements use IF NOT EXISTS for idempotency)
  db.exec(schema);
}

/**
 * Close the database connection gracefully.
 */
export function closeDatabase(db: Database.Database): void {
  db.close();
}

/**
 * Create an in-memory database for testing.
 */
export function createTestDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  // Read and execute schema
  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  db.exec(schema);

  return db;
}
