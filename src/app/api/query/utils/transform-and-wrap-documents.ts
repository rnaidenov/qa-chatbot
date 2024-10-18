import { Document } from "langchain/document";
import { Client } from '@notionhq/client';
import * as path from 'path';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

export const convertDocsToWrappedString = (input: Document[] | string[]): string => {
  const wrappedDocs = input.map((el) => {
    const pageId = extractPageId(el.metadata.source);
    console.log("🚀 ~ combined ~ pageId:", pageId)

    return `<doc> [pageId hash: ${pageId}] \n\n${typeof el === 'string' ? el : el.pageContent}\n</doc>`
  }).join("\n");

  return wrappedDocs;
};

// export const convertDocsToWrappedString = (input: Document[] | string[]): string => {
//   return input.map((el) => {
//     const pageId = typeof el === 'string' ? '' : el.metadata.pageId;

//     return `<doc> [pageId hash: ${pageId}] \n\n${typeof el === 'string' ? el : el.pageContent}\n</doc>`
//   }).join("\n");
// };

async function getImageUrlsFromPage(pageId: string): Promise<Map<string, string>> {
  const imageUrls = new Map<string, string>();
  let cursor: string | undefined;

  do {
    const response: any = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
    });

    for (const block of response.results) {
      if (block.type === 'image') {
        const fileName = path.basename(block.image.file?.url || '');
        const url = block.image.file?.url || block.image.external?.url;
        if (url && fileName) {
          imageUrls.set(fileName, url);
        }
      }
    }

    cursor = response.next_cursor;
  } while (cursor);

  return imageUrls;
}

function extractPageId(source: string): string | null {
  const pageIdRegex = /[a-f0-9]{32}/i;
  const match = source.match(pageIdRegex);
  return match ? match[0] : null;
}

async function transformDocument(doc: { pageContent: string, metadata: { source: string, pageId: string } }) {
  let content = doc.pageContent;
  console.log("🚀 ~ transformDocument ~ doc.metadata.source:", doc.metadata.source)
  const pageId = extractPageId(doc.metadata.source);

  if (!pageId) {
    console.log(`Could not extract page ID from source: ${doc.metadata.source}`);
    return doc;
  }

  doc.metadata.pageId = pageId;


  console.log(`Fetching images for page: ${pageId}`);
  const imageUrls = await getImageUrlsFromPage(pageId);

  // Convert the Map to an array of values
  const imageUrlArray = Array.from(imageUrls.values());

  for (const url of imageUrlArray) {
    const fileName = url.split('/')?.pop()?.split('?')[0];
    content = content.replace(`(${fileName})`, `(${url})`);
  }

  return { ...doc, pageContent: content };
}

export async function transformAndWrapDocuments(docs: Document[]): Promise<string> {
  const transformedDocs = await Promise.all(docs.map(transformDocument));
  return convertDocsToWrappedString(transformedDocs);
}

// Usage example:
async function processDocuments(docs: Document[]) {
  const wrappedContent = await transformAndWrapDocuments(docs);
  // Use wrappedContent as needed
}

// You can call processDocuments with your documents array
// processDocuments(yourDocumentsArray);
