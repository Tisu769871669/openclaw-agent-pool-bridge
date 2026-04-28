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
  if (!article.markdown) {
    throw new Error("markdown is required");
  }
  return article;
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

module.exports = {
  renderWechatHtml,
  validateArticlePackage,
};
