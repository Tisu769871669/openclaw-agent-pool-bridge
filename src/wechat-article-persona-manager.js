const path = require("node:path");

const { SourceMdFileManager } = require("./source-md-file-manager");

const WECHAT_ARTICLE_PERSONA_FILE_NAME = "WECHAT_ARTICLE_PERSONA.md";

class WechatArticlePersonaManager extends SourceMdFileManager {
  constructor(options = {}) {
    super({
      ...options,
      fileName: WECHAT_ARTICLE_PERSONA_FILE_NAME,
      fileLabel: "WECHAT_ARTICLE_PERSONA.md",
      missingCode: "wechat_article_persona_not_found",
    });
  }
}

function createWechatArticlePersonaManager(options = {}) {
  return new WechatArticlePersonaManager(options);
}

function getWechatArticlePersonaPath(workspace) {
  return path.join(workspace, WECHAT_ARTICLE_PERSONA_FILE_NAME);
}

module.exports = {
  WECHAT_ARTICLE_PERSONA_FILE_NAME,
  WechatArticlePersonaManager,
  createWechatArticlePersonaManager,
  getWechatArticlePersonaPath,
};
