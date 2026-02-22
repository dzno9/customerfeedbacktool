export type EvidenceSource = "intercom" | "upload";

export type EvidenceSourceDisplay = {
  href: string | null;
  text: string;
};

function isSupportedProtocol(url: URL) {
  return url.protocol === "http:" || url.protocol === "https:";
}

export function parseEvidenceUrl(sourceUrl: string | null): URL | null {
  if (!sourceUrl || !sourceUrl.trim()) {
    return null;
  }

  try {
    const parsed = new URL(sourceUrl);
    return isSupportedProtocol(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function getEvidenceSourceDisplay(
  source: EvidenceSource,
  sourceUrl: string | null
): EvidenceSourceDisplay {
  const parsed = parseEvidenceUrl(sourceUrl);

  if (parsed) {
    return {
      href: parsed.toString(),
      text: source === "intercom" ? "Open Intercom conversation" : "Open source reference"
    };
  }

  if (source === "intercom") {
    return {
      href: null,
      text: "Intercom conversation link unavailable"
    };
  }

  return {
    href: null,
    text: "Source link unavailable"
  };
}
