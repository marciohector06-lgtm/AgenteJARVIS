import Database from "better-sqlite3";
import { ChromaClient, GoogleGenerativeAiEmbeddingFunction } from "chromadb";

const db = new Database(process.env.SQLITE_PATH || "./jarvis.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sessionId TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_sessionId ON sessions(sessionId);
`);

const insertTurn = db.prepare(
  "INSERT INTO sessions (sessionId, role, content, createdAt) VALUES (?, ?, ?, ?)"
);
const selectPage = db.prepare(
  "SELECT role, content, createdAt FROM sessions WHERE sessionId = ? ORDER BY id DESC LIMIT ? OFFSET ?"
);

export function saveMemory(userId, role, text) {
  insertTurn.run(String(userId), role, text, Date.now());
}

export function getHistory(userId, limit = 20, offset = 0) {
  const rows = selectPage.all(String(userId), limit, offset);
  return rows.reverse().map((row) => ({
    role: row.role,
    text: row.content,
    timestamp: row.createdAt,
  }));
}

function createChromaClient() {
  return new ChromaClient({
    path: process.env.CHROMA_URL || "http://localhost:8000",
  });
}

const embeddingFunction = new GoogleGenerativeAiEmbeddingFunction({
  googleApiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

let client = createChromaClient();
let collectionPromise;

function getCollection() {
  if (!collectionPromise) {
    collectionPromise = client
      .getOrCreateCollection({ name: "jarvis_knowledge", embeddingFunction })
      .catch((error) => {
        // A própria lib chromadb cacheia uma _initPromise interna no client em
        // caso de falha, então além de limpar nosso cache é preciso recriar o
        // client — só resetar collectionPromise não é suficiente.
        collectionPromise = null;
        client = createChromaClient();
        throw error;
      });
  }
  return collectionPromise;
}

export async function saveKnowledge(text, metadata) {
  const collection = await getCollection();
  await collection.add({
    ids: [`knowledge-${Date.now()}-${Math.random().toString(36).slice(2)}`],
    documents: [text],
    metadatas: [metadata],
  });
}

export async function recallMemory(query, nResults = 5) {
  const collection = await getCollection();
  const count = await collection.count();
  if (count === 0) return [];

  const results = await collection.query({
    queryTexts: [query],
    nResults,
  });

  return results.documents[0] || [];
}
