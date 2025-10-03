import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "rainier.db");
const SCHEMA_PATH = path.join(__dirname, "schema.sql");

function createConnection() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  return db;
}

function ensureInitialized() {
  if (fs.existsSync(DB_PATH)) return;
  initDB();
}

export function getDB() {
  ensureInitialized();
  return createConnection();
}

export function initDB() {
  const db = createConnection();
  const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);
  db.close();
}