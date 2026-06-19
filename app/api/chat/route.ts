import { NextResponse } from "next/server";
import { vectorStore } from "@/lib/vectorStore";

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
    const sources = relevantDocs.map((doc) => ({
      text: doc.text.slice(0, 200), // 只取前200字作为引用摘要
      score: doc.score,
    }));

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
          '你是智能助手。\n' +
          '1. 【最高优先级】如果用户上传了文档，必须分析文档内容。绝对禁止在未分析文档的情况下进行闲聊。\n' +
          '2. 如果文档为空或未上传，才作为朋友聊天。\n' +
          '3. 回答必须简短直接，不要解释规则。\n' +
          '4. 必须遵循用户的明确指令（如“分析文档”）。'
      },
      // ★★★ 重点：先放历史记忆 ★★★
      ...cleanHistory,
      // ★★★ 重点：最后放当前问题（包含文档上下文） ★★★
      { role: "user", content: prompt },
    ];
console.log('最终发给大模型的 messages:', JSON.stringify(allMessages, null, 2));
    // 4. 调用大模型（这里以 DeepSeek 为例，你也可以换成其他）
    const response = await fetch(
      "https://api.deepseek.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: allMessages,
          stream: true, // 先不用流式，跑通再说
        }),
      },
    );

    // 如果上游报错，把错误信息透传出来方便调试
    if (!response.ok) {
      const errText = await response.text();
      console.error("SiliconFlow upstream error:", response.status, errText);
      return new Response(
        JSON.stringify({ error: `上游错误 ${response.status}: ${errText}` }),
        { status: 502 },
      );
    }

    // 3. 创建一个 TransformStream 来拦截并追加 sources event
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    // 读取上游流，并转发到 writable
    (async () => {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // 直接转发上游数据
        await writer.write(
          encoder.encode(decoder.decode(value, { stream: true })),
        );
      }
      // 上游流结束后，追加 sources event
      const sourcesEvent = `data: ${JSON.stringify({ type: "sources", sources })}\n\n`;
      await writer.write(encoder.encode(sourcesEvent));
      await writer.close();
    })();

    // const data = await response.json();
    // const reply =
    //   data.choices?.[0]?.message?.content || "抱歉，我暂时无法回答。";
    return new Response(readable, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
    // return NextResponse.json({ reply });
  } catch (error) {
    console.error("Chat error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to chat";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
