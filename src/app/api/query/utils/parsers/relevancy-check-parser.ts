import { z } from 'zod';
import { StructuredOutputParser } from "@langchain/core/output_parsers";

export const RELEVANCY_CHECK_SCHEMA = z.object({
  isRelevant: z.boolean().describe("Is the question relevant to Homa Games?"),
  canPerform: z.boolean().describe("Can the requested action be performed by the AI assistant?"),
  reasoning: z.string().describe("Explanation of why the question is or isn't related to Homa Games, why the requested action should or shouldn't be performed by the AI assistant or user."),
  // relevantSources: z.string().array().describe("An array of document IDs which are actually relevant to the user's question"),
  relevantSources: z.array(
    z.object({
      id: z.string().describe("The pageHash of the relevant document"),
      // content: z.string().describe("The referenced document in its original form as provided in the context. DO NOT SUMMARIZE. Whole document should be included."),
      content: z.string().describe("A part of the referenced document in its original form as provided in the context. DO NOT SUMMARIZE. Include only part that is relevant to the user's question."),
    })
  ).describe("An array of documents which are actually relevant to the user's question"),
});

export const relevancyCheckParser = StructuredOutputParser.fromZodSchema(RELEVANCY_CHECK_SCHEMA);