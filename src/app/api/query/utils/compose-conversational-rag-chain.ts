import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { RunnableSequence, RunnablePassthrough, RunnableWithMessageHistory, RunnableConfig } from '@langchain/core/runnables';
import { RunnableLike } from "@langchain/core/runnables";
import { JsonOutputFunctionsParser, StructuredOutputParser } from "langchain/output_parsers";
import { UpstashRedisChatMessageHistory } from "@langchain/community/stores/message/upstash_redis";
import { QA_CHAIN_TEMPLATE, RELEVANCY_CHECK_TEMPLATE } from './consts';
import { Document } from "langchain/document";
import { ComposeConversationalContextChainArgs } from './types';
import { convertDocsToWrappedString, transformAndWrapDocuments, transformDocs } from './transform-and-wrap-documents';
import { contextualizedQuestion } from './contextualized-question';
import { getMessageHistoryForSessionId } from './get-message-history-for-session-id';
// import { upstashRedisChatHistory } from './upstash-redis-chat-history';
import { sessionIdToUserRole } from './session-id-to-user-role';
import { ChatOpenAI } from '@langchain/openai';
import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });


import { z } from 'zod';
import { log } from 'console';


const logPerformance = (label: string, startTime: number) => {
  const endTime = performance.now();
  console.log(`Performance: ${label} took ${(endTime - startTime).toFixed(2)}ms`);
};

const homaLabParserZodSchema = z.object({
  isRelevant: z.boolean().describe("Is the question relevant to Homa Games?"),
  canPerform: z.boolean().describe("Can the requested action be performed by the AI assistant?"),
  reasoning: z.string().describe("Explanation of why the question is or isn't related to Homa Games, and why the requested action should or shouldn't be performed by the AI assistant"),
  // relevantSources: z.string().array().describe("An array of document IDs which are actually relevant to the user's question"),
  relevantSources: z.array(
    z.object({
      id: z.string().describe("The pageHash of the relevant document"),
      content: z.string().describe("The referenced document in its original form as provided in the context. DO NOT SUMMARIZE. Whole document should be included."),
    })
  ).describe("An array of documents which are actually relevant to the user's question"),
});

// const homaLabParserSchema = {
//   name: "homaLabParser",
//   description: "Parses and extracts information related to Homa Games from the input.",
//   parameters: {
//     type: "object",
//     properties: {
//       isRelevant: {
//         type: "boolean",
//         description: "Is the question relevant to Homa Games?",
//       },
//       canPerform: {
//         type: "boolean",
//         description: "Can the requested action be performed by the AI assistant?",
//       },
//       reasoning: {
//         type: "string",
//         description: "Explanation of why the question is or isn't related to Homa Games, and why the requested action should or shouldn't be performed by the AI assistant",
//       },
//       relevantSources: {
//         type: "array",
//         items: {
//           type: "object",
//           properties: {
//             id: {
//               type: "string",
//               description: "The pageHash of the relevant document",
//             },
//             content: {
//               type: "string",
//               description: "The content of the referenced document with relevant information (including images, links, etc.)",
//             },
//           },
//           required: ["id", "content"],
//         },
//         description: "An array of documents which are actually relevant to the user's question",
//       },
//     },
//     required: ["isRelevant", "canPerform", "reasoning", "relevantSources"],
//   },
// };

const parser = StructuredOutputParser.fromZodSchema(homaLabParserZodSchema);

const createRelevancyCheckChain = (llm: RunnableLike) => {
  const startTime = performance.now();

  const promptTemplate = ChatPromptTemplate.fromTemplate(`
    ${RELEVANCY_CHECK_TEMPLATE}

    {format_instructions}
  `);

  logPerformance("Relevancy check chain creation", startTime);

  return RunnableSequence.from([
    {
      context: (input) => input.context,
      user_info: (input) => input.user_info,
      question: (input) => input.question,
      format_instructions: async () => parser.getFormatInstructions(),
    },
    promptTemplate,
    llm,
    parser,
  ]);
};


async function getAllImagesFromPage(pageId: string): Promise<{ [key: string]: string }> {
  const startTime = performance.now();
  let resourcesMap = {} as { [key: string]: string };
  let hasMore = true;
  let startCursor: string | undefined = undefined;

  while (hasMore) {
    try {
      const response = await notion.blocks.children.list({
        block_id: pageId,
        start_cursor: startCursor,
      });

      for (const block of response.results) {
        if (block.type === 'image') {
          const imageUrl = block.image.file?.url || block.image.external?.url || null;
          if (imageUrl) {
            const imageRef = imageUrl.split('?')[0].split('/').pop();
            if (imageRef) {
              resourcesMap[imageRef] = imageUrl;
            }
          }
        }
      }

      hasMore = response.has_more;
      startCursor = response.next_cursor || undefined;
    } catch (error) {
      console.error("Error fetching Notion page content:", error);
      hasMore = false;
    }
  }

  logPerformance("Fetching images from Notion page", startTime);
  return resourcesMap;
}

async function updateInternalProcessing(summary: any): Promise<string> {
  const startTime = performance.now();
  const updatedSummary = JSON.parse(JSON.stringify(summary)); 

  let resourcesMap = {} as { [key: string]: string };

  // console.log("🚀 ~ updatedSummary.relevantSources:", updatedSummary.relevantSources)
  // for (let source of updatedSummary.relevantSources) {
  //   console.log('relevant', source.id);

  //   const pageImages = await getAllImagesFromPage(source.id);
  //   resourcesMap = { ...resourcesMap, ...pageImages };
  // }

  const relevantResorces = await Promise.all(updatedSummary.relevantSources.map(async (source) => {
    const pageImages = await getAllImagesFromPage(source.id);
    resourcesMap = { ...resourcesMap, ...pageImages }; 

    return `### Source ID: ${source.id}

    ${source.content.replace(/!\[.*\]\(.*\)/g, (match) => {
      const imageRef = match.split('(')[1].split(')')[0];

      return resourcesMap[imageRef] ? `![${imageRef}](${resourcesMap[imageRef]})` : match;
    })}`
  }));

  // Convert the updated summary to a Markdown string
  const markdownContent = `
    # Internal Processing

    ## Relevance and Permissibility
    - **Is Relevant:** ${updatedSummary.isRelevant}
    - **Can Perform:** ${updatedSummary.canPerform}

    ## Reasoning
    ${updatedSummary.reasoning}

    ## Relevant Sources
    ${relevantResorces.join('\n')}
  `;

  console.log("🚀 ~ ${updatedSummary.relevantSources.map ~ markdownContent:", markdownContent)
  
  
  logPerformance("Updating internal processing", startTime);
  return markdownContent.trim();
}

// const createRelevancyCheckChain = (llm: RunnableLike) => {
//   return RunnableSequence.from([
//     ChatPromptTemplate.fromTemplate(RELEVANCY_CHECK_TEMPLATE),
//     llm,
//     jsonParser,
//   ]);

//   // return RunnableSequence.from([
//   //   ChatPromptTemplate.fromTemplate(RELEVANCY_CHECK_TEMPLATE),
//   //   llm,
//   // ]);
// };




const createAnswerGenerationPrompt = () => {
  return ChatPromptTemplate.fromMessages([
    ["system", QA_CHAIN_TEMPLATE],
    new MessagesPlaceholder("history"),
    ["human", "{question}"]
  ]);
};

const createAnswerChain = (llm: RunnableLike, retriever: RunnableLike, userRole: string) => {
  const startTime = performance.now();
  const relevancyCheck = createRelevancyCheckChain(llm)
  const answerGenerationPrompt = createAnswerGenerationPrompt();

  logPerformance("Answer chain creation", startTime);
  return RunnableSequence.from([
    RunnablePassthrough.assign({
      context: async (input: Record<string, unknown>) => {
        if ("history" in input) {
          const chain = contextualizedQuestion(input, { llm }) as RunnableSequence;
          const docs = await chain.pipe(retriever).invoke(input) as Document[]

          return await convertDocsToWrappedString(docs);
        }
        return "";
      },
    }),
    // TODO: Runnable branch
    RunnablePassthrough.assign({
      internal_processing: async (input: Record<string, any>) => {
        const summary = await relevancyCheck.invoke({
          user_info: "The asking user is " + userRole,
          context: input.context, 
          question: input.question,
        });

        console.log("🚀 ~ internal_processing: ~ summary:", summary)

        return updateInternalProcessing(summary);
      },
    }),
    answerGenerationPrompt,
    llm
  ]);
};

function getDocByPageId(context: string, pageIdHash: string): string | null {
  const pattern = new RegExp(`<doc>\\s*\$$pageId hash: ${pageIdHash}\$$(.*?)</doc>`, 's');
  const match = context.match(pattern);
  return match ? match[0].trim() : null;
}


export const composeConversationalContextChain = async ({
  sessionId,
  retriever,
  llm
}: ComposeConversationalContextChainArgs) => {
  console.log("🚀 ~ sessionId:", sessionId)
  if (!sessionId || !retriever || !llm) {
    throw new Error("Missing required parameters for composeConversationalContextChain");
  }

  const answerChain = createAnswerChain(llm, retriever, sessionIdToUserRole(sessionId));

  const chainWithHistory = new RunnableWithMessageHistory({
    runnable: answerChain,
    // using redis-based message history
    // getMessageHistory: (sessionId) => upstashRedisChatHistory(sessionId),
    // using local message history
    getMessageHistory: (sessionId) => getMessageHistoryForSessionId(sessionId),
    inputMessagesKey: "question",
    historyMessagesKey: "history",
  });

  return async (followUpQuestion: string): Promise<ReadableStream<string>> => {
    if (!followUpQuestion.trim()) {
      throw new Error("Follow-up question cannot be empty");
    }

    const config: RunnableConfig = { configurable: { sessionId } };

    try {
      const finalResult = await chainWithHistory.stream(
        { question: followUpQuestion },
        config
      );

      return new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of finalResult) {
              controller.enqueue(chunk.content);
            }
          } catch (error) {
            console.error("Error processing stream:", error);
            controller.error(error);
          } finally {
            controller.close();
          }
        },
      });
    } catch (error) {
      console.error("Error in conversational context chain:", error);
      throw error;
    }
  };
};