import { Document } from "langchain/document";

export const convertDocsToWrappedString = (documents: Document[]): string => {
  return documents.map((document) => {
    return `<doc>\n${document.pageContent}\n</doc>`
  }).join("\n");
};