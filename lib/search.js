export const SUGGESTION_STOP_WORDS = new Set(['a','an','the','and','or','of','in','to','for','with','on','at','by','from']);

export function recordMatchesSearch(record, query) {
  const fields = record.fields;
  const constructs = Array.isArray(fields["Construct(s)"]) ? fields["Construct(s)"] : [];
  const translationLangs = (fields.translations || []).map(tr => tr["Language"]).filter(Boolean);

  // Whole-query substring match against name, reference, description, constructs, or translation languages
  if (fields["Measure Name"]?.toLowerCase().includes(query)) return true;
  if (fields["Primary Reference"]?.toLowerCase().includes(query)) return true;
  if (fields["Description of Measure"]?.toLowerCase().includes(query)) return true;
  if (constructs.some(c => c.toLowerCase().includes(query))) return true;
  if (translationLangs.some(l => l.toLowerCase().includes(query))) return true;

  // Multi-keyword match: split the query into tokens, drop stop words, and return
  // true if every token appears somewhere across all searchable fields combined.
  const tokens = query.split(/\W+/).filter(t => t.length > 1 && !SUGGESTION_STOP_WORDS.has(t));
  if (tokens.length >= 2) {
    const fullText = [
      fields["Measure Name"] ?? "",
      fields["Primary Reference"] ?? "",
      fields["Description of Measure"] ?? "",
      ...constructs,
      ...translationLangs,
    ].join(" ").toLowerCase();
    return tokens.every(token => fullText.includes(token));
  }

  return false;
}
