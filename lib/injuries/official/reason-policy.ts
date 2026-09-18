/**
 * Official injury-report reason policy v1 (Phase 5C).
 *
 * Pure deterministic classifier: reason_raw → reason_category + health_relation.
 * Does NOT use status, identity, outcomes, minutes, or network I/O.
 *
 * Version: official-injury-reason-policy-v1
 * Precedence matches Phase 5B design exactly.
 */

export const OFFICIAL_INJURY_REASON_POLICY_VERSION =
  'official-injury-reason-policy-v1' as const;

export type ReasonCategory =
  | 'INJURY_OR_ILLNESS'
  | 'ILLNESS'
  | 'CONCUSSION'
  | 'INJURY_MANAGEMENT'
  | 'RECONDITIONING'
  | 'REST'
  | 'PERSONAL'
  | 'NOT_WITH_TEAM'
  | 'SUSPENSION'
  | 'TRADE_RELATED'
  | 'G_LEAGUE_TWO_WAY'
  | 'G_LEAGUE_ON_ASSIGNMENT'
  | 'G_LEAGUE_ASSIGNMENT'
  | 'COACHS_DECISION'
  | 'INELIGIBLE_TO_PLAY'
  | 'PLACEHOLDER_REASON'
  | 'UNCLASSIFIED';

export type HealthRelation = 'HEALTH_RELATED' | 'NON_HEALTH_RELATED' | 'UNCLASSIFIED';

export type ClassificationRule =
  | 'BLANK_REASON'
  | 'PREFIX_INJURY_ILLNESS'
  | 'PREFIX_G_LEAGUE'
  | 'PREFIX_OR_EXACT_REST'
  | 'PREFIX_OR_EXACT_PERSONAL'
  | 'PREFIX_OR_EXACT_NOT_WITH_TEAM'
  | 'EXACT_COACHS_DECISION'
  | 'EXACT_INELIGIBLE_TO_PLAY'
  | 'EXACT_RECONDITIONING'
  | 'PLACEHOLDER'
  | 'KEYWORD_SUSPENSION'
  | 'KEYWORD_TRADE'
  | 'KEYWORD_CONCUSSION'
  | 'FALLBACK_UNCLASSIFIED';

export type ReasonClassification = {
  reason_policy_version: typeof OFFICIAL_INJURY_REASON_POLICY_VERSION;
  reason_raw: string | null;
  reason_analysis_key: string;
  reason_category: ReasonCategory;
  health_relation: HealthRelation;
  classification_rule: ClassificationRule;
  family_prefix: string | null;
};

const HEALTH_RELATED: ReadonlySet<ReasonCategory> = new Set([
  'INJURY_OR_ILLNESS',
  'ILLNESS',
  'CONCUSSION',
  'INJURY_MANAGEMENT',
  'RECONDITIONING',
]);

const NON_HEALTH: ReadonlySet<ReasonCategory> = new Set([
  'REST',
  'PERSONAL',
  'NOT_WITH_TEAM',
  'SUSPENSION',
  'TRADE_RELATED',
  'G_LEAGUE_TWO_WAY',
  'G_LEAGUE_ON_ASSIGNMENT',
  'G_LEAGUE_ASSIGNMENT',
  'COACHS_DECISION',
  'INELIGIBLE_TO_PLAY',
]);

export function isHealthRelatedCategory(cat: ReasonCategory): boolean {
  return HEALTH_RELATED.has(cat);
}

export function isNonHealthCategory(cat: ReasonCategory): boolean {
  return NON_HEALTH.has(cat);
}

export function reasonAnalysisKey(raw: string | null | undefined): string {
  const s0 = raw == null ? '' : String(raw);
  let s = s0.normalize('NFKC').trim().toLowerCase();
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/([;:,\-_\/])\1+/g, '$1');
  return s;
}

function extractFamilyPrefix(raw: string): string | null {
  const idx = raw.indexOf(' - ');
  if (idx < 0) return null;
  return raw.slice(0, idx).trim();
}

function result(
  raw: string | null,
  category: ReasonCategory,
  rule: ClassificationRule,
  familyPrefix: string | null
): ReasonClassification {
  let health: HealthRelation;
  if (HEALTH_RELATED.has(category)) health = 'HEALTH_RELATED';
  else if (NON_HEALTH.has(category)) health = 'NON_HEALTH_RELATED';
  else health = 'UNCLASSIFIED';

  return {
    reason_policy_version: OFFICIAL_INJURY_REASON_POLICY_VERSION,
    reason_raw: raw,
    reason_analysis_key: reasonAnalysisKey(raw),
    reason_category: category,
    health_relation: health,
    classification_rule: rule,
    family_prefix: familyPrefix,
  };
}

/**
 * Classify an official injury reason_raw string.
 * Status / identity / outcomes must NOT be passed in.
 */
export function classifyOfficialInjuryReason(
  reasonRaw: string | null | undefined
): ReasonClassification {
  if (reasonRaw == null || String(reasonRaw).trim() === '') {
    return result(reasonRaw == null ? null : String(reasonRaw), 'UNCLASSIFIED', 'BLANK_REASON', null);
  }

  const text = String(reasonRaw).trim();
  const key = reasonAnalysisKey(text);
  const family = extractFamilyPrefix(text);

  // 1a) Injury/Illness structural prefix
  if (/^injury\/illness\b/i.test(text)) {
    let cat: ReasonCategory;
    if (/\bconcussion\b/i.test(text)) {
      cat = 'CONCUSSION';
    } else if (/injury management/i.test(text)) {
      cat = 'INJURY_MANAGEMENT';
    } else if (/\breconditioning\b/i.test(text)) {
      cat = 'RECONDITIONING';
    } else {
      const detail = text.includes(' - ') ? text.split(' - ').slice(1).join(' - ') : text;
      const illnessHits = (detail.match(/\billness\b/gi) || []).length;
      const injuryMarker =
        /\b(sprain|strain|fracture|surgery|soreness|tear|contusion|bruise|tendin|meniscus|ligament|acl|mcl|achilles|ankle|knee|hamstring|calf|hip|back|shoulder|wrist|finger|toe|foot|elbow|rib|groin|adductor|glute|quadriceps|patella|labrum|plantar|fibula|management|recovery)\b/i.test(
          detail
        );
      cat = illnessHits > 0 && !injuryMarker ? 'ILLNESS' : 'INJURY_OR_ILLNESS';
    }
    return result(text, cat, 'PREFIX_INJURY_ILLNESS', family);
  }

  // 1b) G League
  if (/^g league\b/i.test(text)) {
    let cat: ReasonCategory;
    if (/two[- ]?way/i.test(text)) cat = 'G_LEAGUE_TWO_WAY';
    else if (/on assignment/i.test(text)) cat = 'G_LEAGUE_ON_ASSIGNMENT';
    else cat = 'G_LEAGUE_ASSIGNMENT';
    return result(text, cat, 'PREFIX_G_LEAGUE', family);
  }

  // 1c) Rest (including Rest - …)
  if (/^rest(\b|$| -)/i.test(text) || /^rest$/i.test(text)) {
    return result(text, 'REST', 'PREFIX_OR_EXACT_REST', family || 'Rest');
  }

  // 1d) Personal / Not With Team
  if (/^personal reasons?\b/i.test(text) || /^personal reasons?$/i.test(text)) {
    return result(text, 'PERSONAL', 'PREFIX_OR_EXACT_PERSONAL', family || 'Personal Reasons');
  }
  if (/^not with team\b/i.test(text) || /^not with team$/i.test(text)) {
    return result(text, 'NOT_WITH_TEAM', 'PREFIX_OR_EXACT_NOT_WITH_TEAM', family || 'Not With Team');
  }

  // 2) Exact high-confidence
  if (/^coach'?s decision$/i.test(text)) {
    return result(text, 'COACHS_DECISION', 'EXACT_COACHS_DECISION', family);
  }
  if (/^ineligible to play$/i.test(text)) {
    return result(text, 'INELIGIBLE_TO_PLAY', 'EXACT_INELIGIBLE_TO_PLAY', family);
  }
  if (/^(return to competition\s+)?reconditioning$/i.test(text) || /^competition reconditioning$/i.test(text)) {
    return result(text, 'RECONDITIONING', 'EXACT_RECONDITIONING', family);
  }
  if (
    key === '-' ||
    key === '—' ||
    key === '–' ||
    key === 'n/a' ||
    key === 'na' ||
    key === 'none' ||
    key === '.' ||
    key.startsWith('-')
  ) {
    return result(text, 'PLACEHOLDER_REASON', 'PLACEHOLDER', family);
  }

  // 3) Keyword
  if (/\bsuspension\b/i.test(text)) {
    return result(text, 'SUSPENSION', 'KEYWORD_SUSPENSION', family);
  }
  if (/\btrade\b/i.test(text)) {
    return result(text, 'TRADE_RELATED', 'KEYWORD_TRADE', family);
  }
  if (/\bconcussion\b/i.test(text)) {
    return result(text, 'CONCUSSION', 'KEYWORD_CONCUSSION', family);
  }

  // 4) Fail closed
  return result(text, 'UNCLASSIFIED', 'FALLBACK_UNCLASSIFIED', family);
}
