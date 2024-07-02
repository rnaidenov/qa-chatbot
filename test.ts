import * as fs from 'fs';
import * as path from 'path';
import csv from 'csv-parser';
import { createObjectCsvWriter } from 'csv-writer';

import { composeConversationalContextChain } from "./src/app/api/query/utils/compose-conversational-rag-chain";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { QdrantVectorStore } from "@langchain/qdrant";
import { MatryoshkaRetriever } from "langchain/retrievers/matryoshka_retriever";

type QAResult = {
  Question: string;
  Response: string;
}

const results: QAResult[] = [];
const outputFilePath = './data/notion-qs-processed.csv';

const smallEmbeddings = new OpenAIEmbeddings({
  model: "text-embedding-3-small",
  dimensions: 512,
});
const largeEmbeddings = new OpenAIEmbeddings({
  model: "text-embedding-3-large",
  dimensions: 1536,
});

const processQuestion = async (question: string) => {
  try {
    const llm = new ChatOpenAI({ model: "gpt-4o", temperature: 0 });

    const vectorStore = new QdrantVectorStore(smallEmbeddings, {
      url: process.env.QDRANT_URL,
      collectionName: "qa-chatbot",
    });

    const retriever = new MatryoshkaRetriever({
      vectorStore,
      largeEmbeddingModel: largeEmbeddings,
      largeK: 5,
    });

    const sessionId = 'dsd';

    const conversationalRAGChain = await composeConversationalContextChain({ sessionId, retriever, llm });

    return conversationalRAGChain(question);
  } catch (error) {
    console.error('Error during handleResponse:', error);
    throw error;
  }
};

const readCSV = async (filePath: string): Promise<QAResult[]> => {
  return new Promise((resolve, reject) => {
    const results: QAResult[] = [];
    fs.createReadStream(filePath)
      .pipe(csv({
        mapHeaders: ({ header }) => header.trim(),
      }))
      .on('data', (data) => {
        if (data && data.Question && data.Question.length > 0) {
          results.push({ Question: data.Question?.trim(), Response: '' });
        } else {
          console.error('No Question field found in data:', data);
        }
      })
      .on('end', () => {
        resolve(results);
      })
      .on('error', (error) => {
        reject(error);
      });
  });
};

const processCSV = async () => {
  try {
    const questions = await readCSV('./data/notion-qs.csv');
    const promises = questions.map(async (qa) => {
      console.log("🚀 ~ promises ~ qa:", qa.Question)
      try {
        const response = await processQuestion(qa.Question);
        qa.Response = response;
      } catch (error) {
        console.error('Error processing question:', error);
      }
    });
    await Promise.all(promises);
    return questions;
  } catch (error) {
    console.error('Error reading CSV file:', error);
    throw error;
  }
};

(async () => {
  try {
    const processedResults = await processCSV();
    const csvWriter = createObjectCsvWriter({
      path: outputFilePath,
      header: [
        { id: 'Question', title: 'Question' },
        { id: 'Response', title: 'Response' }
      ]
    });
    await csvWriter.writeRecords(processedResults);
    console.log('CSV file successfully processed and written.');
  } catch (error) {
    console.error('Error processing CSV file:', error);
  }
})();
