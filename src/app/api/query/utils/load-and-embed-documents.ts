import { Index, Pinecone, RecordMetadata } from "@pinecone-database/pinecone";
import { CSVLoader } from "langchain/document_loaders/fs/csv";
import { DirectoryLoader } from "langchain/document_loaders/fs/directory";
import { JSONLoader, JSONLinesLoader } from "langchain/document_loaders/fs/json";
import { NotionLoader } from "@langchain/community/document_loaders/fs/notion";
import { TextLoader } from "langchain/document_loaders/fs/text";
import { SplitOpts } from "./types";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { PineconeStore } from "@langchain/pinecone";
import { OpenAIEmbeddings } from "@langchain/openai";
import { PineconeIndex } from "./pinecone-index";
import { MatryoshkaRetriever } from "langchain/retrievers/matryoshka_retriever";
import { Chroma } from "@langchain/community/vectorstores/chroma";
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
  })

  const retriever = new MatryoshkaRetriever({
    vectorStore,
    largeEmbeddingModel: largeEmbeddings,
    largeK: 5,
  });
  const docs = await loader.load();

  await retriever.addDocuments(docs);
  const query = "How to delete an idea?";
  const results = await retriever.invoke(query);
  console.log(results.map(({ pageContent }) => pageContent).join("\n"));

  // const splitter = new RecursiveCharacterTextSplitter({
  //   chunkSize: 500,
  //   chunkOverlap: 50,
  // });
  // const splitDocuments = await splitter.splitDocuments(docs);

  // await PineconeStore.fromDocuments(
  //   splitDocuments,
  //   largeEmbeddings, {
  //   pineconeIndex: PineconeIndex.RagApp,
  //   maxConcurrency: 5,
  // });
};

// await loadAndEmbedDocuments('./notion');

// await PineconeIndex.RagApp.deleteAll();