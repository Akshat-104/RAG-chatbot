import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
import { MongoClient } from "mongodb";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";

export default async function getvectorStore() {
    const client = new MongoClient(process.env.MONGODB_ATLAS_URI);
    await client.connect();
    const collection = client
    .db(process.env.MONGODB_ATLAS_DB_NAME)
    .collection(process.env.MONGODB_ATLAS_COLLECTION_NAME);

    const embeddings = new GoogleGenerativeAIEmbeddings({
        model:"gemini-embedding-001",
        apiKey:process.env.GOOGLE_API_KEY,
    })

    const vectorStore = new MongoDBAtlasVectorSearch(embeddings, {
    collection: collection,
    indexName: "vector_index",
    textKey: "text",
    embeddingKey: "embedding",
    });
    
    return {vectorStore , client}
}