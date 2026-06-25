import { NextResponse } from "next/server";
import { vectorStore } from "@/lib/vectorStore";
import { getCurrentTimeTool, searchDocsTool, executeTool } from "@/lib/tools";
import { wrapStreamWithSources, simulateStream } from "@/lib/streamUtils";
import { isToolMessage } from "openai/lib/chatCompletionUtils.mjs";

type SourceItem = {
  text: string;
  score: number;
  source?: string;
};

type ToolCall = {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
};

type ToolResult = {
  toolCall: ToolCall;
  result: string;
};

type SearchDocResult = {
  text: string;
  score: number;
  source?: string;
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { message, history } = await request.json();
    // 放在文件最上面，接收请求后立即打印
    console.log("------------------");
    console.log("收到用户问题:", message);
    console.log("收到历史记录:", history);
    console.log("------------------");
    if (!message) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 },
      );
    }

    // 1. 从向量库检索相关文档片段
    const relevantDocs = await vectorStore.search(message, 3);

    // if (relevantDocs.length === 0) {
    //   return NextResponse.json({
    //     reply: "请先上传文档，我才能回答基于文档的问题。",
    //   });
    // }
    const cleanHistory = (history || []).map(
      (msg: { role: string; content: string }) => ({
        role: msg.role,
        content: msg.content,
      }),
    );
    // ★★★ 关键修复：如果历史最后一条是空的助手回复，补上默认内容 ★★★
    if (
      cleanHistory.length > 0 &&
      cleanHistory[cleanHistory.length - 1].role === "assistant" &&
      !cleanHistory[cleanHistory.length - 1].content.trim()
    ) {
      cleanHistory[cleanHistory.length - 1].content = "好的"; // 或者 "请问还有什么可以帮您？"
    }
    // 2. 拼接上下文
    const context = relevantDocs
      .map((doc, i) => `【相关片段 ${i + 1}】\n${doc.text}`)
      .join("\n\n");

    // 3. 构造 prompt
    const prompt = `文档内容：
                    ${context}
                    用户问题：${message}`;

    const allMessages = [
      {
        role: "system",
        content:
          "你是智能助手。\n" +
          "1. 【最高优先级】如果用户上传了文档，必须分析文档内容。绝对禁止在未分析文档的情况下进行闲聊。\n" +
          "2. 如果文档为空或未上传，才作为朋友聊天。\n" +
          "3. 回答必须简短直接，不要解释规则。\n" +
          "4. 必须遵循用户的明确指令（如“分析文档”）。",
      },
      // ★★★ 重点：先放历史记忆 ★★★
      ...cleanHistory,
      // ★★★ 重点：最后放当前问题（包含文档上下文） ★★★
      { role: "user", content: prompt },
    ];

    // 第一次调用（非流式，判断是否需要调用工具）
    const currentMessages = [...allMessages];
    const maxRounds = 3;

    for (let round = 0; round < maxRounds; round++) {
      const response = await fetch(
        "https://api.deepseek.com/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: currentMessages,
            tools: [getCurrentTimeTool, searchDocsTool],
            tool_choice: "auto",
            stream: false,
          }),
        },
      );

      const data = await response.json();
      const choice = data.choices?.[0];

      if (choice.finish_reason === "stop") {
        const sources = relevantDocs.map((doc) => ({
          text: doc.text.slice(0, 200), // 只取前200字作为引用摘要
          score: doc.score,
        }));
        // 直接回答，模拟流式返回
        return simulateStream(choice.message.content, sources);
      } else if (choice.finish_reason === "tool_calls") {
        // 执行所有工具调用
        // 执行所有工具调用，并收集 sources
        const sources: SourceItem[] = [];
        const toolResults: ToolResult[] = [];
        
        for (const toolCall of choice.message.tool_calls) {
          const args = JSON.parse(toolCall.function.arguments);
          const result = await executeTool(toolCall.function.name, args);
          toolResults.push({ toolCall, result });

          if (toolCall.function.name === "search_docs") {
            const docs = JSON.parse(result);
            sources.push(
              ...docs.map((d: SearchDocResult) => ({
                text: d.text.slice(0, 200),
                score: d.score,
                source: d.source || "",
              })),
            );
          }
        }

        // 构造第二次请求的 messages
        const secondMessages = [
          ...currentMessages,
          choice.message,
          ...toolResults.map((r) => ({
            role: "tool" as const,
            tool_call_id: r.toolCall.id,
            content: r.result,
          })),
        ];

        // ---------- 第二次请求（流式）----------
        const secondRes = await fetch(
          "https://api.deepseek.com/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
            },
            body: JSON.stringify({
              model: "deepseek-chat",
              messages: secondMessages,
              stream: true,
            }),
          },
        );

        if (!secondRes.ok) {
          const err = await secondRes.text();
          return new Response(
            JSON.stringify({ error: `第二次请求失败: ${err}` }),
            { status: 500 },
          );
        }

        // 包装流并追加 sources
        const wrappedStream = wrapStreamWithSources(secondRes.body, sources);
        return new Response(wrappedStream, {
          headers: { "Content-Type": "text/event-stream" },
        });
      } else {
        // 其他情况（如 length），直接返回错误
        return new Response(JSON.stringify({ error: "模型响应异常" }), {
          status: 500,
        });
      }
    }

    // 超过最大轮数
    return new Response(JSON.stringify({ error: "工具调用次数过多" }), {
      status: 400,
    });
    // return NextResponse.json({ reply });
  } catch (error) {
    console.error("Chat error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to chat";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
