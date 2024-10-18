import { NotionLoader } from "@langchain/community/document_loaders/fs/notion";
import { OpenAIEmbeddings } from "@langchain/openai";
import { MatryoshkaRetriever } from "langchain/retrievers/matryoshka_retriever";
import { QdrantVectorStore } from "@langchain/qdrant";

export const loadAndEmbedDocuments = async (
  folderSrc: string,
) => {
  const loader = new NotionLoader(
    folderSrc,
  );

  const smallEmbeddings = new OpenAIEmbeddings({
    model: "text-embedding-3-small",
    dimensions: 512, // Min num for small
  });
  const largeEmbeddings = new OpenAIEmbeddings({
    model: "text-embedding-3-large",
    dimensions: 1536, // Max num for large
  });

  const vectorStore = new QdrantVectorStore(smallEmbeddings, {
    url: process.env.QDRANT_URL || "http://localhost:6333",
    apiKey: process.env.QDRANT_API_KEY,
    collectionName: "qa-chatbot",
  });

  const retriever = new MatryoshkaRetriever({
    vectorStore,
    largeEmbeddingModel: largeEmbeddings,
    largeK: 5,
  });
  const docs = await loader.load();

  // await retriever.addDocuments(docs);
  // const query = "How to delete an idea?";
  // const results = await retriever.invoke(query);
  // console.log(results.map(({ pageContent }) => pageContent).join("\n"));
};

// measure performance
// const start = performance.now();
// await loadAndEmbedDocuments('./notion');
// await loadAndEmbedDocuments('./hg-damysus-sdk-documentation');
// const end = performance.now();
// console.log('Execution time: ', end - start);