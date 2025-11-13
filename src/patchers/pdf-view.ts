import { TFile, ViewStateResult, Notice } from 'obsidian';
import { around } from 'monkey-around';

import PDFPlus from 'main';
import { PDFView } from 'typings';
import { patchPDFInternals } from './pdf-internals';
import { getPdfPathFromXfdf } from 'utils/xfdf'; // 导入我们新创建的工具

export const patchPDFView = (plugin: PDFPlus): boolean => {
    if (plugin.patchStatus.pdfView && plugin.patchStatus.pdfInternals) return true;

    const lib = plugin.lib;

    const pdfView = lib.getPDFView();
    if (!pdfView) return false;

    if (!plugin.patchStatus.pdfView) {
        plugin.register(around(pdfView.constructor.prototype, {
            getState(old) {
                return function () {
                    const ret = old.call(this);
                    const self = this as PDFView;
                    const child = self.viewer.child;
                    const pdfViewer = child?.pdfViewer?.pdfViewer;
                    if (pdfViewer) {
                        // When the PDF viewer's top edge is on the lower half of the previous page,
                        // pdfViewer._location?.pageNumber points to the previous page, but 
                        // currentPageNumber points to the current page.
                        // For our purpose, the former is preferable, so we use it if available.
                        ret.page = pdfViewer._location?.pageNumber ?? pdfViewer.currentPageNumber;
                        ret.left = pdfViewer._location?.left;
                        ret.top = pdfViewer._location?.top;
                        ret.zoom = pdfViewer.currentScale;
                    }
                    return ret;
                };
            },
            setState(old) {
                return function (state: any, result: ViewStateResult): Promise<void> {
                    if (plugin.settings.alwaysRecordHistory) {
                        result.history = true;
                    }
                    return old.call(this, state, result).then(() => {
                        const self = this as PDFView;
                        const child = self.viewer.child;
                        const pdfViewer = child?.pdfViewer?.pdfViewer;
                        if (typeof state.page === 'number') {
                            if (pdfViewer) {
                                lib.applyPDFViewStateToViewer(pdfViewer, state);
                            }
                        }
                    });
                };
            },
            // Called inside onModify
            onLoadFile(old) {
                return async function (file: TFile) {
                    // Restore the last page, position & zoom level on file mofiication
                    const self = this as PDFView;

                    // 检查是否是 XFDF 文件
                    if (file.extension === 'xfdf') {
                        const pdfInfo = await getPdfPathFromXfdf(plugin.app, file, lib);
                        if (pdfInfo && pdfInfo.externalPath) {
                            // 直接设置重定向，跳过文件检测
                            return self.viewer.then(async (child) => {
                                if (child.pdfViewer) {
                                    const externalPath = pdfInfo.externalPath;
                                    const redirectFrom = plugin.app.vault.getResourcePath(file).replace(/\?\d+$/, '');
                                                    
                                    // 设置重定向映射
                                    child.pdfViewer.pdfPlusRedirect = { 
                                        from: redirectFrom, 
                                        to: externalPath 
                                    };
                                                    
                                    // 标记为外部文件
                                    child.isFileExternal = true;
                                    child.externalFileUrl = externalPath;
                                                    
                                    // 调用原始 loadFile
                                    await child.loadFile(file);
                                                    
                                    // 清理重定向
                                    delete child.pdfViewer.pdfPlusRedirect;
                                }
                            });
                        } else {
                            new Notice("PDF++: Failed to load PDF from XFDF file");
                            return;
                        }
                    }

                    
                    // 只有不是 XFDF 文件时才会执行到这里
                    const state = self.getState();
                    const subpath = lib.viewStateToSubpath(state);
                    return self.viewer.loadFile(file, subpath ?? undefined);
                };
            }
        }));

        plugin.patchStatus.pdfView = true;

        // @ts-ignore
        plugin.classes.PDFView = pdfView.constructor;
    }

    if (!plugin.patchStatus.pdfInternals) patchPDFInternals(plugin, pdfView.viewer);

    // don't return true here; if patchPDFInternals is successful, plugin.patchStatus.pdfInternals
    // will be set to true when this function is called next time, and then this function will
    // return true
    return false;
};
