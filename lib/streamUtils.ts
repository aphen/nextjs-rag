// lib/streamUtils.ts
type SourceItem = Record<string, unknown>;

// ---------- 辅助函数：包装上游流并追加 sources ----------
export function wrapStreamWithSources(
  upstreamBody: ReadableStream | null,
  sources: SourceItem[]
): ReadableStream {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  (async () => {
    if (upstreamBody) {
      const reader = upstreamBody.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(encoder.encode(decoder.decode(value, { stream: true })));
      }
    }
    // 追加 sources 事件
    const sourcesEvent = `data: ${JSON.stringify({ type: "sources", sources })}\n\n`;
    await writer.write(encoder.encode(sourcesEvent));
    await writer.close();
  })();

  return readable;
}

// 模拟流式返回函数
export function simulateStream(content: string, sources: Record<string, unknown>[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // 按字符分割，模拟逐字输出
      for (const char of content) {
        const data = `data: ${JSON.stringify({ choices: [{ delta: { content: char } }] })}\n\n`;
        controller.enqueue(encoder.encode(data));
      }
       // 追加 sources 事件
      const sourcesEvent = `data: ${JSON.stringify({ type: "sources", sources })}\n\n`;
      controller.enqueue(encoder.encode(sourcesEvent));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}