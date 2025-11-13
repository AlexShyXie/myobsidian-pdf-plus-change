// src/utils/xfdf.ts
import { App, TFile, Notice, normalizePath, FileSystemAdapter } from 'obsidian';
import { existsSync } from 'fs'; // 导入文件存在性检查函数

/**
 * 从 XFDF 文件内容中解析出 PDF 路径，并返回一个虚拟TFile对象用于加载外部PDF
 * @param app Obsidian App 实例
 * @param file XFDF TFile 实例
 * @param lib PDFPlus 的库实例
 * @returns 返回一个虚拟TFile对象，包含外部PDF的file:///路径
 */

export async function getPdfPathFromXfdf(app: App, file: TFile, lib: any): Promise<{ path: string, externalPath: string } | null> {
    try {
        const content = await app.vault.read(file);
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(content, "text/xml");

        // 获取 PDF 路径
        const pdfFileElement = xmlDoc.querySelector("f[href]");
        if (!pdfFileElement) {
            console.error("PDF++: XFDF file does not contain a <f href='...'> tag.");
            return null;
        }
        
        let pdfPath = pdfFileElement.getAttribute("href") || "";
        let finalPdfPath: string;

        // 判断路径类型并处理
        if (pdfPath.startsWith('/')) {
            // 处理 /G:/... 格式
            const match = pdfPath.match(/^\/([A-Za-z])\//);
            if (match) {
                const driveLetter = match[1];
                let restOfPath = pdfPath.substring(match[0].length);
                restOfPath = normalizePath(restOfPath);
                finalPdfPath = `file:///${driveLetter}:${restOfPath}`;
            } else {
                new Notice("PDF++: Invalid external PDF path format.");
                return null;
            }
        } 
        else if (/^[A-Za-z]:/.test(pdfPath)) {
            // 处理 G:/... 格式
            pdfPath = normalizePath(pdfPath);
            finalPdfPath = `file:///${pdfPath}`;
        }
        else if (pdfPath.startsWith('./') || pdfPath.startsWith('../') || !pdfPath.includes(':')) {
            // 处理相对路径格式，如 ../../path/to/file.pdf
            const { join } = require('path');
            
            // 获取 vault 基础路径
            const adapter = app.vault.adapter;
            if (adapter instanceof FileSystemAdapter) {
                const vaultBasePath = adapter.getBasePath(); // 例如：E:/MyVault
                
                // 获取 XFDF 文件所在目录（相对于 vault 根目录）
                const xfdfDirPath = file.path.substring(0, file.path.lastIndexOf('/')); // 例如：folder
                
                // 解析相对路径为绝对路径
                // 例如：join("E:/MyVault", "folder", "../pdfs/file.pdf") 
                // 结果：E:/MyVault/pdfs/file.pdf
                let absolutePath = join(vaultBasePath, xfdfDirPath, pdfPath);
                absolutePath = normalizePath(absolutePath);
                finalPdfPath = `file:///${absolutePath}`;
            } else {
                new Notice("PDF++: Cannot resolve relative path: vault is not using file system adapter");
                return null;
            }
        }
        else {
            new Notice(`PDF++: Unsupported PDF path format: "${pdfPath}"`);
            return null;
        }

        // 提取文件系统的绝对路径（去掉 file:/// 前缀）
        const systemPath = finalPdfPath.replace(/^file:\/\/\//, '');
        
        // 检查文件是否存在
        if (!existsSync(systemPath)) {
            new Notice(`PDF++: Referenced PDF file not found: ${systemPath}`);
            return null;
        }

        // 使用 Platform.resourcePathPrefix 转换路径
        const { Platform } = require('obsidian');
        const obsidianPath = Platform.resourcePathPrefix + finalPdfPath.substring(8);

        return {
            path: file.path,
            externalPath: obsidianPath
        };

    } catch (error) {
        console.error("PDF++: Failed to parse XFDF file:", error);
        return null;
    }
}





