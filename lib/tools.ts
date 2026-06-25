import { vectorStore } from "./vectorStore";
export const getCurrentTimeTool = {
  type: "function",
  function: {
    name: "get_current_time",
    description:
      "获取当前的系统时间，包括日期和时间。当用户询问当前时间、日期或时间相关问题时使用。",
    parameters: {
      type: "object",
      properties: {}, // 不需要参数
      required: [],
    },
  },
};

export const searchDocsTool = {
  type: "function",
  function: {
    name: "search_docs",
    description: "搜索企业内部文档库，获取与问题相关的知识片段。当用户问题涉及文档内容、需要从文档中查找信息时使用。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "搜索关键词，建议提取问题中的核心实体或关键短语",
        },
        top_k: {
          type: "number",
          description: "返回的片段数量，默认3",
          default: 3,
        },
      },
      required: ["query"],
    },
  },
};
// 工具执行函数
export async function executeTool<T extends Record<string, unknown>>(name: string, args: T): Promise<string> {
  switch (name) {
    case "get_current_time":
      const now = new Date();
      return JSON.stringify({
        datetime: now.toISOString(),
        date: now.toLocaleDateString("zh-CN"),
        time: now.toLocaleTimeString("zh-CN"),
        weekday: now.toLocaleDateString("zh-CN", { weekday: "long" }),
      });
    case "search_docs":
      const { query, top_k = 3 } = args;
      const docs = await vectorStore.search(query as string, top_k as number);
      return JSON.stringify(docs.map((d, i) => ({
        index: i,
        text: d.text,
        score: d.score,
        // source: d.source || "",
      })));
    default:
      return "未知工具";
  }
}
