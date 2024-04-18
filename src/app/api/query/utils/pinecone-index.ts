import { Pinecone as PineconeConstructor } from "@pinecone-database/pinecone";

const pc = new PineconeConstructor({
  apiKey: process.env.PINECONE_API_KEY as string
});

export const PineconeIndex = {
  RagApp: pc.Index("rag-app")
}
