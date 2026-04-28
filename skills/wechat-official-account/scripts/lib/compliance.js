function checkCompliance(text, profile) {
  const content = String(text || "");
  const avoid = Array.isArray(profile?.contentRules?.avoid) ? profile.contentRules.avoid : [];
  const matches = [];

  for (const term of avoid) {
    const keyword = String(term || "").trim();
    if (keyword && content.includes(keyword)) {
      matches.push({ term: keyword, severity: "high" });
    }
  }

  return {
    passed: matches.length === 0,
    matches,
  };
}

module.exports = {
  checkCompliance,
};
