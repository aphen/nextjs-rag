import { NextResponse } from "next/server";
import { getData } from "pdf-parse/worker";
// import { PDFParse } from "pdf-parse";
// import mammoth from "mammoth";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { splitTextIntoChunks } from "@/lib/chunk";
import { vectorStore } from '@/lib/vectorStore';

import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { DocxLoader } from "@langchain/community/document_loaders/fs/docx";

// PDFParse.setWorker(getData());
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

    let rawDocuments;
    // 解析文件
    if (fileName.endsWith(".pdf")) {
      const loader = new PDFLoader(tempFilePath, {
        // 可选：分割页面，每页一个 Document
        splitPages: true,
      });
      rawDocuments = await loader.load();
      // const dataBuffer = await fs.readFile(tempFilePath);
      // const parser = new PDFParse({ data: dataBuffer });
      // try {
      //   const result = await parser.getText();
      //   textContent = result.text;
      // } finally {
      //   await parser.destroy();
      // }    
    } else if (fileName.endsWith(".docx")) {
      const loader = new DocxLoader(tempFilePath);
      rawDocuments = await loader.load();
      // const dataBuffer = await fs.readFile(tempFilePath);
      // const result = await mammoth.extractRawText({ buffer: dataBuffer });
      // textContent = result.value;
    } else {
      // 清理临时文件
      await fs.unlink(tempFilePath);
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
    }

     // ===== 今天新增的核心逻辑 =====
    console.log('========================================');
    console.log(`文件: ${file.name}`);
    console.log(`解析完成: ${rawDocuments.length} 个文档`);

    // 合并所有页面的文本（PDFLoader 返回每页一个 Document）
    const fullText = rawDocuments.map(doc => doc.pageContent).join('\n\n');

    // 3.1 分块
    const chunks = splitTextIntoChunks(fullText, file.name, 500);
    console.log(`分块完成: ${chunks.length} 块`);
    
    // 3.2 向量化 + 入库
    await vectorStore.addChunks(chunks, file.name);
    
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
      textLength: fullText.length,
      chunksCount: chunks.length,
      stats,
      preview: fullText.substring(0, 500), // 前500字符预览
      fullText, // 完整文本（生产环境建议去掉或压缩）
    });
  } catch (error) {
    console.error("Error processing file:", error);
    return NextResponse.json(
      { error: "Failed to process file" },
      { status: 500 },
    );
  }
}
