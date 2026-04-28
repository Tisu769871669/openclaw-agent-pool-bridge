function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function validateArticlePackage(input) {
  const article = {
    title: String(input?.title || "").trim(),
    digest: String(input?.digest || "").trim(),
    author: String(input?.author || "").trim(),
    markdown: String(input?.markdown || "").trim(),
    coverPath: String(input?.coverPath || "").trim(),
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

function renderInline(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
}

function renderWechatHtml(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  let listOpen = false;

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

module.exports = {
  renderWechatHtml,
  validateArticlePackage,
};
