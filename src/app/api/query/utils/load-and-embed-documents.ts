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

export const loadAndEmbedDocuments = async (
  folderSrc: string,
) => {
  const loader = new NotionLoader(
    folderSrc,
  );

  const docs = await loader.load();


  const largeEmbeddings = new OpenAIEmbeddings({
    model: "text-embedding-3-large",
    dimensions: 3072,
  });


  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 50,
  });
  const splitDocuments = await splitter.splitDocuments(docs);

  await PineconeStore.fromDocuments(
    splitDocuments,
    largeEmbeddings, {
    pineconeIndex: PineconeIndex.RagApp,
    maxConcurrency: 5,
  });
};

// await loadAndEmbedDocuments('./notion');

// await PineconeIndex.RagApp.deleteAll();