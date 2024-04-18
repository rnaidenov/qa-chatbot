import { Index, Pinecone, RecordMetadata } from "@pinecone-database/pinecone";
import { ChatOpenAI } from "langchain/chat_models/openai";
import { CSVLoader } from "langchain/document_loaders/fs/csv";
import { DirectoryLoader } from "langchain/document_loaders/fs/directory";
import { JSONLoader, JSONLinesLoader } from "langchain/document_loaders/fs/json";
import { NotionLoader } from "langchain/document_loaders/fs/notion";
import { TextLoader } from "langchain/document_loaders/fs/text";
import { SplitOpts } from "./types";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { PineconeStore } from "@langchain/pinecone";
import { EmbeddingsInterface } from "langchain/embeddings/base";

const DirectoryLoaderOpts = {
  ".json": (path: string) => new JSONLoader(path, "/texts"),
  ".jsonl": (path: string) => new JSONLinesLoader(path, "/html"),
  ".csv": (path: string) => new CSVLoader(path, "text"),
  ".txt": (path: string) => new TextLoader(path),
  ".md": (path: string) => new NotionLoader(path),
}

export const loadAndEmbedDocuments = async (
  folderSrc: string,
  opts: {
    split: SplitOpts,
    embeddings: EmbeddingsInterface,
    pineconeIndex: Index<RecordMetadata> | undefined
  }
) => {
  const loader = new DirectoryLoader(
    folderSrc,
    DirectoryLoaderOpts
  );

  const docs = await loader.load();

  const splitter = new RecursiveCharacterTextSplitter(opts.split);
  const splitDocuments = await splitter.splitDocuments(docs);

  await PineconeStore.fromDocuments(splitDocuments, opts.embeddings, {
    pineconeIndex: opts.pineconeIndex,
    maxConcurrency: 5,
  });
}