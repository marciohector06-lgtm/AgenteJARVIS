import { ChromaClient, GoogleGenerativeAiEmbeddingFunction } from "chromadb";

const client = new ChromaClient({
  path: process.env.CHROMA_URL || "http://localhost:8000",
});

const embeddingFunction = new GoogleGenerativeAiEmbeddingFunction({
  googleApiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

let collectionPromise;

function getCollection() {
  if (!collectionPromise) {
    collectionPromise = client.getOrCreateCollection({
      name: "jarvis_memory",
      embeddingFunction,
    });
  }
  return collectionPromise;
}

export async function saveMemory(userId, role, text) {
  const collection = await getCollection();
  await collection.add({
    ids: [`${userId}-${Date.now()}-${Math.random().toString(36).slice(2)}`],
    documents: [text],
    metadatas: [{ userId: String(userId), role, timestamp: Date.now() }],
  });
}

export async function recallMemory(userId, query, nResults = 5) {
  const collection = await getCollection();
  const count = await collection.count();
  if (count === 0) return [];

  const results = await collection.query({
    queryTexts: [query],
    nResults,
    where: { userId: String(userId) },
  });

  return results.documents[0] || [];
}

export async function getHistory(userId, limit = 20) {
  const collection = await getCollection();
  const results = await collection.get({
    where: { userId: String(userId) },
    include: ["documents", "metadatas"],
  });

  const turns = results.ids.map((id, i) => ({
    role: results.metadatas[i].role,
    text: results.documents[i],
    timestamp: results.metadatas[i].timestamp,
  }));

  turns.sort((a, b) => a.timestamp - b.timestamp);

  return turns.slice(-limit);
}
