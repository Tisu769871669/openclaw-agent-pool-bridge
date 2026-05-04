const path = require("node:path");

const { SourceMdFileManager } = require("./source-md-file-manager");

const WECHAT_MOMENTS_PERSONA_FILE_NAME = "WECHAT_MOMENTS_PERSONA.md";

class WechatMomentsPersonaManager extends SourceMdFileManager {
  constructor(options = {}) {
    super({
      ...options,
      fileName: WECHAT_MOMENTS_PERSONA_FILE_NAME,
      fileLabel: "WECHAT_MOMENTS_PERSONA.md",
      missingCode: "wechat_moments_persona_not_found",
    });
  }
}

function createWechatMomentsPersonaManager(options = {}) {
  return new WechatMomentsPersonaManager(options);
}

function getWechatMomentsPersonaPath(workspace) {
  return path.join(workspace, WECHAT_MOMENTS_PERSONA_FILE_NAME);
}

module.exports = {
  WECHAT_MOMENTS_PERSONA_FILE_NAME,
  WechatMomentsPersonaManager,
  createWechatMomentsPersonaManager,
  getWechatMomentsPersonaPath,
};
