// async function getAllImagesFromPage(pageId: string): Promise<{ [key: string]: string }> {
//   const startTime = performance.now();
//   let resourcesMap = {} as { [key: string]: string };
//   let hasMore = true;
//   let startCursor: string | undefined = undefined;

//   while (hasMore) {
//     try {
//       const response = await notion.blocks.children.list({
//         block_id: pageId,
//         start_cursor: startCursor,
//       });

//       for (const block of response.results) {
//         if (block.type === 'image') {
//           const imageUrl = block.image.file?.url || block.image.external?.url || null;
//           if (imageUrl) {
//             const imageRef = imageUrl.split('?')[0].split('/').pop();
//             if (imageRef) {
//               resourcesMap[imageRef] = imageUrl;
//             }
//           }
//         }
//       }

//       hasMore = response.has_more;
//       startCursor = response.next_cursor || undefined;
//     } catch (error) {
//       console.error("Error fetching Notion page content:", error);
//       hasMore = false;
//     }
//   }

//   logPerformance("Fetching images from Notion page", startTime);
//   return resourcesMap;
// }


export async function updateInternalProcessing(summary: any): Promise<string> {
  // TODO: Extract images from notion
  // let resourcesMap = {} as { [key: string]: string };

  // console.log("🚀 ~ updatedSummary.relevantSources:", updatedSummary.relevantSources)
  // for (let source of updatedSummary.relevantSources) {
  //   console.log('relevant', source.id);

  //   const pageImages = await getAllImagesFromPage(source.id);
  //   resourcesMap = { ...resourcesMap, ...pageImages };
  // }

  // const relevantResorces = await Promise.all(updatedSummary.relevantSources.map(async (source) => {
  //   const pageImages = await getAllImagesFromPage(source.id);
  //   resourcesMap = { ...resourcesMap, ...pageImages }; 

  //   return `### Source ID: ${source.id}

  //   ${source.content.replace(/!\[.*\]\(.*\)/g, (match) => {
  //     const imageRef = match.split('(')[1].split(')')[0];

  //     return resourcesMap[imageRef] ? `![${imageRef}](${resourcesMap[imageRef]})` : match;
  //   })}`
  // }));

  // Convert the updated summary to a Markdown string
  const markdownContent = `
    # Internal Processing

    ## Relevance and Permissibility
    - **Is Relevant:** ${summary.isRelevant}
    - **Can Perform:** ${summary.canPerform}

    ## Reasoning
    ${summary.reasoning}

    ## Relevant Sources
    ${summary.relevantSources.map((res) => res.content).join('\n')}
  `;

  return markdownContent.trim();
}

function getDocByPageId(context: string, pageIdHash: string): string | null {
  const pattern = new RegExp(`<doc>\\s*\$$pageId hash: ${pageIdHash}\$$(.*?)</doc>`, 's');
  const match = context.match(pattern);
  return match ? match[0].trim() : null;
}