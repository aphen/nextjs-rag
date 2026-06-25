import { NextResponse } from "next/server";
import { getData } from "pdf-parse/worker";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { splitTextIntoChunks } from "@/lib/chunk";
import { vectorStore } from '@/lib/vectorStore';

PDFParse.setWorker(getData());
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // 检查文件类型
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith(".pdf") && !fileName.endsWith(".docx")) {
      return NextResponse.json(
        { error: "Only PDF and DOCX files are supported" },
        { status: 400 },
      );
    }


    // 保存文件到临时目录
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, file.name);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(tempFilePath, buffer);

    let textContent = "";

    // 解析文件
    if (fileName.endsWith(".pdf")) {
      const dataBuffer = await fs.readFile(tempFilePath);
      const parser = new PDFParse({ data: dataBuffer });
      try {
        const result = await parser.getText();
        textContent = result.text;
      } finally {
        await parser.destroy();
      }    
    } else if (fileName.endsWith(".docx")) {
      const dataBuffer = await fs.readFile(tempFilePath);
      const result = await mammoth.extractRawText({ buffer: dataBuffer });
      textContent = result.value;
    }

     // ===== 今天新增的核心逻辑 =====
    console.log('========================================');
    console.log(`文件: ${file.name}`);
    console.log(`解析完成: ${textContent.length} 字符`);

    // 3.1 分块
    const chunks = splitTextIntoChunks(textContent);
    console.log(`分块完成: ${chunks.length} 块`);
    
    // 3.2 向量化 + 入库
    await vectorStore.addChunks(chunks);
    
    // 3.3 获取统计
    const stats = vectorStore.getStats();
    console.log('========================================');

    // 清理临时文件
    try {
      await fs.unlink(tempFilePath);
    } catch (error) {
      console.error("Error deleting temporary file:", error);
    }

    // 返回解析结果
    return NextResponse.json({
      success: true,
      fileName: file.name,
      textLength: textContent.length,
      chunksCount: chunks.length,
      stats,
      preview: textContent.substring(0, 500), // 前500字符预览
      fullText: textContent, // 完整文本（生产环境建议去掉或压缩）
    });
  } catch (error) {
    console.error("Error processing file:", error);
    return NextResponse.json(
      { error: "Failed to process file" },
      { status: 500 },
    );
  }
}
