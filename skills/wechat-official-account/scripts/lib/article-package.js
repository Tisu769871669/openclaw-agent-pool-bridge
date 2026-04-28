function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function validateArticlePackage(input) {
  const article = {
    title: String(input?.title || "").trim(),
    digest: String(input?.digest || "").trim(),
    author: String(input?.author || "").trim(),
    markdown: String(input?.markdown || "").trim(),
    html: String(input?.html || "").trim(),
    coverPath: String(input?.coverPath || "").trim(),
    contentImages: normalizeContentImages(input?.contentImages),
    contentImagePaths: Array.isArray(input?.contentImagePaths) ? input.contentImagePaths.map(String) : [],
    sourceLinks: Array.isArray(input?.sourceLinks) ? input.sourceLinks.map(String) : [],
  };

  if (!article.title) {
    throw new Error("title is required");
  }
  if (!article.digest) {
    throw new Error("digest is required");
  }
  if (!article.markdown && !article.html) {
    throw new Error("markdown or html is required");
  }
  assertNoEditorialInstructions(`${article.title}\n${article.digest}\n${article.markdown}\n${article.html}`);
  if (article.html) {
    assertSafeWechatHtml(article.html);
  }
  return article;
}

function assertNoEditorialInstructions(value) {
  const text = String(value || "");
  const blockedPatterns = [
    /这篇直接按[\s\S]{0,40}方式来/i,
    /小红书穿搭笔记[\s\S]{0,30}一屏一个重点/i,
    /短句[、,，]\s*公式[、,，]\s*避雷点/i,
    /输出\s*JSON/i,
    /写作要求/i,
    /生成要求/i,
    /提示词/i,
  ];
  for (const pattern of blockedPatterns) {
    if (pattern.test(text)) {
      throw new Error("editorial instruction text is not allowed in article body");
    }
  }
}

function assertSafeWechatHtml(html) {
  const blockedPatterns = [
    /<\s*script\b/i,
    /<\s*iframe\b/i,
    /<\s*object\b/i,
    /<\s*embed\b/i,
    /<\s*form\b/i,
    /<\s*input\b/i,
    /\son[a-z]+\s*=/i,
    /javascript\s*:/i,
  ];
  for (const pattern of blockedPatterns) {
    if (pattern.test(html)) {
      throw new Error("unsafe html is not allowed in article package");
    }
  }
}

function normalizeContentImages(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item, index) => {
    const key = String(item?.key || `image${index + 1}`).trim();
    const image = {
      key,
      path: String(item?.path || "").trim(),
      alt: String(item?.alt || "").trim(),
    };
    if (!image.key) {
      throw new Error("contentImages[].key is required");
    }
    if (!image.path) {
      throw new Error(`contentImages[${image.key}].path is required`);
    }
    return image;
  });
}

function renderInline(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
}

function renderWechatHtml(markdown, options = {}) {
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  let listOpen = false;
  const imageUrls = options.imageUrls || {};

  function closeList() {
    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }
    const imageMatch = line.match(/^\{\{image:([a-zA-Z0-9_-]+)\}\}$/);
    if (imageMatch) {
      closeList();
      const image = normalizeImageUrl(imageUrls[imageMatch[1]]);
      if (image.url) {
        html.push(renderWechatImage(image.url, image.alt));
      }
      continue;
    }
    if (line.startsWith("## ")) {
      closeList();
      html.push(`<h2>${renderInline(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith("# ")) {
      closeList();
      html.push(`<h1>${renderInline(line.slice(2))}</h1>`);
      continue;
    }
    if (line.startsWith("- ")) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${renderInline(line.slice(2))}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${renderInline(line)}</p>`);
  }
  closeList();
  return html.join("\n");
}

function renderArticleContent(article, options = {}) {
  const body = article.html
    ? renderWechatReadyHtml(article.html, options)
    : renderWechatHtml(article.markdown, options);
  const footer = renderArticleFooter(options.footer, options);
  return footer ? `${body}\n${footer}` : body;
}

function renderWechatReadyHtml(html, options = {}) {
  const imageUrls = options.imageUrls || {};
  return String(html || "").replace(/\{\{image:([a-zA-Z0-9_-]+)\}\}/g, (_match, key) => {
    const image = normalizeImageUrl(imageUrls[key]);
    return image.url ? renderWechatImage(image.url, image.alt) : "";
  });
}

function normalizeImageUrl(value) {
  if (typeof value === "string") {
    return { url: value, alt: "" };
  }
  return {
    url: String(value?.url || "").trim(),
    alt: String(value?.alt || "").trim(),
  };
}

function renderWechatImage(url, alt = "") {
  return [
    '<p style="margin: 18px 0; text-align: center;">',
    `<img src="${escapeAttribute(url)}" data-src="${escapeAttribute(url)}" alt="${escapeAttribute(alt)}" style="max-width: 100%; height: auto; display: block; margin: 0 auto;" />`,
    "</p>",
  ].join("");
}

function renderArticleFooter(footer, options = {}) {
  if (!footer?.enabled) {
    return "";
  }
  const imageUrls = options.imageUrls || {};
  const parts = [
    '<section style="margin: 28px 0 0; padding: 18px 14px; background: #fff8ef; border-radius: 8px; text-align: center; color: #5b4f45;">',
  ];
  if (footer.title) {
    parts.push(`<p style="margin: 0 0 8px; font-size: 17px;"><strong>${escapeHtml(footer.title)}</strong></p>`);
  }
  if (footer.description) {
    parts.push(`<p style="margin: 0 0 14px; color: #8a6a52;">${escapeHtml(footer.description)}</p>`);
  }
  const miniProgram = footer.miniProgram || {};
  if (miniProgram.appId && miniProgram.path && miniProgram.title && miniProgram.imageUrl) {
    parts.push(renderMiniProgramCard(miniProgram));
  }
  for (const image of footer.qrImages || []) {
    const uploaded = normalizeImageUrl(imageUrls[image.key]);
    if (!uploaded.url) {
      continue;
    }
    parts.push(renderWechatImage(uploaded.url, image.alt));
    if (image.caption) {
      parts.push(`<p style="margin: -8px 0 14px; color: #9a8a7a; font-size: 13px;">${escapeHtml(image.caption)}</p>`);
    }
  }
  parts.push("</section>");
  return parts.join("\n");
}

function renderMiniProgramCard(miniProgram) {
  return [
    `<mp-miniprogram data-miniprogram-appid="${escapeAttribute(miniProgram.appId)}"`,
    ` data-miniprogram-path="${escapeAttribute(miniProgram.path)}"`,
    ` data-miniprogram-title="${escapeAttribute(miniProgram.title)}"`,
    ` data-miniprogram-imageurl="${escapeAttribute(miniProgram.imageUrl)}">`,
    "</mp-miniprogram>",
  ].join("");
}

module.exports = {
  renderArticleFooter,
  renderArticleContent,
  renderWechatHtml,
  validateArticlePackage,
};
