import { StateGraphArgs } from "@langchain/langgraph";
import { Document, type DocumentInterface } from "@langchain/core/documents";

import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { pull } from "langchain/hub";
import { ChatOpenAI } from "@langchain/openai";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { JsonOutputToolsParser } from "langchain/output_parsers";

import { OpenAIEmbeddings } from "@langchain/openai";
import { MatryoshkaRetriever } from "langchain/retrievers/matryoshka_retriever";
import { QdrantVectorStore } from "@langchain/qdrant";


/**
 * Represents the state of our graph.
 */
type GraphState = {
  documents: Document[];
  question: string;
  generation?: string;
  providedFeedback?: string;
  regeneration?: string;
};

const graphState: StateGraphArgs<GraphState>["channels"] = {
  documents: {
    value: (left?: Document[], right?: Document[]) =>
      right ? right : left || [],
    default: () => [],
  },
  question: {
    value: (left?: string, right?: string) => (right ? right : left || ""),
    default: () => "",
  },
  generation: {
    value: (left?: string, right?: string) => (right ? right : left),
    default: () => undefined,
  },
  providedFeedback: {
    value: (left?: string, right?: string) => (right ? right : left),
    default: () => undefined,
  },
  regeneration: {
    value: (left?: string, right?: string) => (right ? right : left),
    default: () => undefined,
  },
};


// Data model (create via a LangChain tool)
const zodScore = z.object({
  binaryScore: z.enum(["yes", "no"]).describe("Relevance score 'yes' or 'no'"),
});
class Grade extends StructuredTool {
  name = "grade";
  description =
    "Grade the relevance of the retrieved documents to the question. Either 'yes' or 'no'.";
  schema = zodScore;
  async _call(input: z.infer<(typeof this)["schema"]>) {
    return JSON.stringify(input);
  }
}
const gradeTool = new Grade();




const smallEmbeddings = new OpenAIEmbeddings({
  model: "text-embedding-3-small",
  dimensions: 512,
});
const largeEmbeddings = new OpenAIEmbeddings({
  model: "text-embedding-3-large",
  dimensions: 1536,
});

const llm = new ChatOpenAI({ model: "gpt-4o", temperature: 0 });

const vectorStore = new QdrantVectorStore(smallEmbeddings, {
  url: process.env.QDRANT_URL,
  collectionName: "qa-chatbot",
})

const retriever = new MatryoshkaRetriever({
  vectorStore,
  largeEmbeddingModel: largeEmbeddings,
  largeK: 5,
});

/**
 * Retrieve documents
 *
 * @param {GraphState} state The current state of the graph.
 * @param {RunnableConfig | undefined} config The configuration object for tracing.
 * @returns {Promise} The new state object.
 */
async function retrieve(state: GraphState) {
  console.log("---RETRIEVE---");
  const documents = await retriever
    .withConfig({ runName: "FetchRelevantDocuments" })
    .invoke(state.question);
  return {
    documents,
  };
}

/**
 * Generate answer
 *
 * @param {GraphState} state The current state of the graph.
 * @param {RunnableConfig | undefined} config The configuration object for tracing.
 * @returns {Promise} The new state object.
 */
async function generate(state: GraphState) {
  console.log("---GENERATE---");
  // Pull in the prompt
  // LLM
  const llm = new ChatOpenAI({
    modelName: "gpt-3.5-turbo",
    temperature: 0,
  });

  const answerGenerationPrompt = ChatPromptTemplate.fromMessages([
    ["system", QA_CHAIN_TEMPLATE],
    [
      "human",
      "{question}"
    ]
  ]);

  // RAG Chain
  const ragChain = answerGenerationPrompt.pipe(llm).pipe(new StringOutputParser());
  const formattedDocs = state.documents
    .map((doc) => doc.pageContent)
    .join("\n\n");

  const generation = await ragChain.invoke({
    context: formattedDocs,
    question: state.question,
    user_info: JSON.stringify({
      role: "Internal",
    })
  });

  return {
    generation,
  };
}

/**
 * Determines whether the retrieved documents are relevant to the question.
 *
 * @param {GraphState} state The current state of the graph.
 * @param {RunnableConfig | undefined} config The configuration object for tracing.
 * @returns {Promise} The new state object.
 */
async function gradeDocuments(state: GraphState) {
  console.log("---CHECK RELEVANCE---");
  const model = new ChatOpenAI({
    modelName: "gpt-4-0125-preview",
    temperature: 0,
  });

  const parser = new JsonOutputToolsParser();

  // LLM with tool and enforce invocation
  const llmWithTool = model.bindTools([gradeTool], {
    tool_choice: { type: "function", function: { name: gradeTool.name } },
  });

  const prompt = ChatPromptTemplate.fromTemplate(
    `You are a grader assessing relevance of a retrieved document to a user question.
  Here is the retrieved document:
  
  {context}
  
  Here is the user question: {question}

  If the document contains keyword(s) or semantic meaning related to the user question, grade it as relevant.
  Give a binary score 'yes' or 'no' score to indicate whether the document is relevant to the question.`,
  );

  // Chain
  const chain = prompt.pipe(llmWithTool).pipe(parser);

  const filteredDocs: Array<Document> = [];
  for await (const doc of state.documents) {
    const grade = await chain.invoke({
      context: doc.pageContent,
      question: state.question,
    });
    const { args } = grade[0];
    if (args.binaryScore === "yes") {
      console.log("---GRADE: DOCUMENT RELEVANT---");
      filteredDocs.push(doc);
    } else {
      console.log("---GRADE: DOCUMENT NOT RELEVANT---");
    }
  }

  return {
    documents: filteredDocs,
  };
}

/**
 * Transform the query to produce a better question.
 *
 * @param {GraphState} state The current state of the graph.
 * @param {RunnableConfig | undefined} config The configuration object for tracing.
 * @returns {Promise} The new state object.
 */
async function transformQuery(state: GraphState) {
  console.log("---TRANSFORM QUERY---");
  // Pull in the prompt
  const prompt = ChatPromptTemplate.fromTemplate(
    `You are generating a question that is well optimized for semantic search retrieval.
  Look at the input and try to reason about the underlying sematic intent / meaning.
  Here is the initial question:
  \n ------- \n
  {question} 
  \n ------- \n
  Formulate an improved question: `,
  );

  // Grader
  const model = new ChatOpenAI({
    modelName: "gpt-4-0125-preview",
    temperature: 0,
    streaming: true,
  });

  // Prompt
  const chain = prompt.pipe(model).pipe(new StringOutputParser());
  const betterQuestion = await chain.invoke({ question: state.question });

  return {
    question: betterQuestion,
  };
}

async function regenerate(state: GraphState) {
  console.log("---REGENERATE QUERY---");
  const regenerationPrompt = ChatPromptTemplate.fromTemplate(`
      You are the ultimate QA answer editor for HomaGames bot.

      ## OBJECTIVE:
      - Based on context, refine the answer given the provided feedback. 

      ## INPUT:
      - The user's question
      - A proposed answer
      - The feedback provided on the answer

      ## OUTPUT RULES:
      - Be clear and concise! Provide a direct answer to the user's question.
      - Only elaborate if the user explicitly requests more information.
      - If detailed information might be helpful, offer a relevant link instead of explaining everything.
      - Say, that you DO NOT KNOW, if you are not confident in your answer.

      ## CONTEXT:
      <context>
        {context}
      </context>

      <question>
        {question}
      </question>

      <answer>
        {answer}
      </answer>

      <feedback>
        {providedFeedback}
      </feedback>
    `);

  // Grader
  const model = new ChatOpenAI({
    modelName: "gpt-4-0125-preview",
    temperature: 0,
    streaming: true,
  });

  console.log('state.providedFeedback', state.providedFeedback);

  // Prompt
  const chain = regenerationPrompt.pipe(model).pipe(new StringOutputParser());
  const regeneration = await chain.invoke({
    question: state.question,
    answer: state.generation ?? '',
    providedFeedback: state.providedFeedback ?? '',
    context: state.documents.map((doc) => doc.pageContent).join("\n\n"),
  });

  return {
    regeneration: regeneration,
  };
}

/**
 * Web search based on the re-phrased question using Tavily API.
 *
 * @param {GraphState} state The current state of the graph.
 * @param {RunnableConfig | undefined} config The configuration object for tracing.
 * @returns {Promise} The new state object.
 */
async function webSearch(state: GraphState) {
  console.log("---WEB SEARCH---");

  const tool = new TavilySearchResults();
  const docs = await tool.invoke({ query: state.question });
  const webResults = new Document({ pageContent: docs });
  const newDocuments = state.documents.concat(webResults);

  return {
    documents: newDocuments,
  };
}

async function feedback(state: GraphState) {
  console.log("---FEEDBACK---");

  const prompt = ChatPromptTemplate.fromTemplate(
    `Act as if you are a user who ahs asked a question to HomaGames bot. 
    \n ------- \n
    {question} 
    \n ------- \n

    ## Instructions
    Provide feedback for the generarted answer, considering clarity and brievity of the response. 

    Give a score from 1 to 5, considering the following:

    -- Was the answer clear and concise?
    -- Was the answer relevant to the question?
    -- Can the answer be shortened by, say, giving a link to a relevant page?
    -- Did the anaswer consider relevant permission restrictions? Could it have been more simply answered by just saying that you don't have the permission to access the information?
       say, could it have been more simply answer by just saying that you don't have the permission to access the information?

    ## Answer
    {answer}
    `,
  );

  const model = new ChatOpenAI({
    modelName: "gpt-4-0125-preview",
    temperature: 0,
    streaming: true,
  });

  // Prompt
  const chain = prompt.pipe(model).pipe(new StringOutputParser());
  const providedFeedback = await chain.invoke({ question: state.question, answer: state.generation ?? '' });
  console.log("🚀 ~ feedback ~ feedback:", providedFeedback)

  return {
    providedFeedback,
  };
}

/**
 * Determines whether to generate an answer, or re-generate a question.
 *
 * @param {GraphState} state The current state of the graph.
 * @returns {"transformQuery" | "generate"} Next node to call
 */
function decideToGenerate(state: GraphState) {
  console.log("---DECIDE TO GENERATE---");
  const filteredDocs = state.documents;

  if (filteredDocs.length === 0) {
    // All documents have been filtered checkRelevance
    // We will re-generate a new query
    console.log("---DECISION: TRANSFORM QUERY---");
    return "transformQuery";
  }
  // We have relevant documents, so generate answer
  console.log("---DECISION: GENERATE---");
  return "generate";
}

/**
 * Determines whether to regenerate the answer based on feedback.
 *
 * @param {GraphState} state The current state of the graph.
 * @returns {"generate" | "END"} Next node to call
 */
function decideToRegenerate(state: GraphState) {
  console.log("---DECIDE TO REGENERATE---");

  // TODO: Make value
  console.log("🚀 ~ decideToRegenerate ~ state.providedFeedback:", state.providedFeedback)
  // const feedbackScore = parseInt(state.providedFeedback || "0", 10);
  const feedbackScore = 0;

  if (feedbackScore < 4) {
    console.log("---DECISION: REGENERATE---");
    return "regenerate";
  }
  console.log("---DECISION: END---");
  return "END";
}


import { END, START, StateGraph } from "@langchain/langgraph";
import { QA_CHAIN_TEMPLATE } from "./api/query/utils/consts";

const workflow = new StateGraph({
  channels: graphState,
})
  // Define the nodes
  .addNode("retrieve", retrieve)
  .addNode("gradeDocuments", gradeDocuments)
  .addNode("generate", generate)
  .addNode("transformQuery", transformQuery)
  .addNode("webSearch", webSearch)
  .addNode("feedback", feedback)
  .addNode("regenerate", regenerate)

// Build graph
workflow.addEdge(START, "retrieve");
workflow.addEdge("retrieve", "gradeDocuments");
workflow.addConditionalEdges(
  "gradeDocuments",
  decideToGenerate,
);
workflow.addEdge("transformQuery", "webSearch");
workflow.addEdge("webSearch", "generate");
workflow.addEdge("generate", "feedback");
workflow.addConditionalEdges(
  "feedback",
  decideToRegenerate,
);
workflow.addEdge("regenerate", END);
// workflow.addEdge("regenerate", "feedback");
// workflow.addEdge("feedback", END);



// Compile
const app = workflow.compile();


const inputs = {
  question: "Game is ready for test. If okay can u check?",
};
const config = { recursionLimit: 50 };
let finalGeneration;
for await (const output of await app.stream(inputs, config)) {
  for (const [key, value] of Object.entries(output)) {
    console.log(`Node: '${key}'`);
    // Optional: log full state at each node
    // console.log(JSON.stringify(value, null, 2));
    finalGeneration = value;
  }
  console.log("\n---\n");
}

// Log the final generation.
console.log(JSON.stringify(finalGeneration, null, 2));
