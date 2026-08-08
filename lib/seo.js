const MAX_DESCRIPTION_LENGTH = 360;

function truncate(text, max) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + "…";
}

// "Primary Reference" is free-text, but every sample in this app's data follows the
// same APA shape: "Authors (Year). Title. Journal, Vol(Issue), pages. DOI" — so this
// is a best-effort scrape of that one shape, not a general citation parser. Returns
// null (rather than a wrong guess) for anything that doesn't match, and callers fall
// back to the raw reference string in that case.
function parseCitation(reference) {
  if (!reference) return null;
  const match = reference.match(/^(.*?)\((\d{4}[a-z]?)\)\.\s*([^.]+)\./);
  if (!match) return null;
  const [, authors, year, title] = match;
  if (!authors.trim()) return null;
  return { authors: authors.trim(), year: year.trim(), title: title.trim() };
}

// Leads with the measure name and citation (authors, year, title) — the identifying
// facts a researcher searches by — then the free-text "Description of Measure", so the
// citation survives truncation even when the description is long. Falls back to the
// raw "Primary Reference" string when it doesn't match the expected citation shape.
export function measureMetaDescription(record) {
  const fields = record.fields || {};
  const name = (fields["Measure Name"] || "").trim();
  const description = (fields["Description of Measure"] || "").trim();
  const reference = (fields["Primary Reference"] || "").trim();
  const citation = parseCitation(reference);

  const segments = [];
  if (description) segments.push(description);
  if (citation) {
    segments.push(`${citation.authors} (${citation.year})`);
    if (citation.title && citation.title.toLowerCase() !== name.toLowerCase()) {
      segments.push(citation.title);
    }
  } else if (reference) {
    
  if (name) segments.push(name);
    segments.push(reference);
  }

  const body = segments.join(". ");
  return body ? truncate(body, MAX_DESCRIPTION_LENGTH) : "";
}

export function measureKeywords(record) {
  const fields = record.fields || {};
  const citation = parseCitation((fields["Primary Reference"] || "").trim());
  const parts = [
    fields["Measure Name"],
    ...(fields["Construct(s)"] || []),
    ...(fields["Language(s)"] || []),
    citation?.authors,
    citation?.year,
    citation?.title,
  ]
    .filter(Boolean)
    .map((s) => String(s).trim());
  return [...new Set(parts)].join(", ");
}
