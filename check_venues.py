#!/usr/bin/env python3
"""Audit and normalize venues in setlist.json.

Design goals:
- No third-party dependencies.
- High-confidence changes only.
- Leave uncertain venue names untouched.
- Write a machine-readable report for manual review.

Expected repository layout:
- setlist.json
- scripts/check_venues.py
- reports/venue_audit.json (generated)
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple

ROOT = Path(__file__).resolve().parents[1]
SETLIST_PATH = ROOT / "setlist.json"
REPORT_PATH = ROOT / "reports" / "venue_audit.json"

STATUS_EXACT = "exact_current"
STATUS_TYPO = "typo_or_format_issue"
STATUS_OLD = "old_name_or_renamed"
STATUS_CLOSED = "closed_or_inactive"
STATUS_REVIEW = "needs_manual_review"
STATUS_DUPLICATE = "duplicate_alias_candidate"


@dataclass(frozen=True)
class Rule:
    suggested_name: str
    status: str
    reason: str
    confidence: str = "high"
    evidence_type: str = "curated_registry"
    auto_apply: bool = True


# High-confidence, curated rules.
# Keep this list conservative. Only add entries you are comfortable auto-applying.
EXPLICIT_RULES: Dict[str, Rule] = {
    # typo / formatting
    "LIQUDROOM": Rule(
        suggested_name="LIQUIDROOM",
        status=STATUS_TYPO,
        reason="Official venue spelling is LIQUIDROOM; input is missing the second 'I'.",
    ),
    # known sponsor / naming changes
    "TSUTAYA O-Crest": Rule(
        suggested_name="Spotify O-Crest",
        status=STATUS_OLD,
        reason="Known sponsor-name era alias; current widely used name is Spotify O-Crest.",
    ),
    "TSUTAYA O-WEST": Rule(
        suggested_name="Spotify O-WEST",
        status=STATUS_OLD,
        reason="Known sponsor-name era alias; current widely used name is Spotify O-WEST.",
    ),
    "TSUTAYA O-EAST": Rule(
        suggested_name="Spotify O-EAST",
        status=STATUS_OLD,
        reason="Known sponsor-name era alias; current widely used name is Spotify O-EAST.",
    ),
    # style / formatting unification where the target is already commonly used in this repo ecosystem
    "渋谷Club asia": Rule(
        suggested_name="clubasia",
        status=STATUS_TYPO,
        reason="Style/branding normalization to the commonly used canonical form clubasia.",
    ),
    # do not auto-delete/rename closed venues; only flag them
    "渋谷glad": Rule(
        suggested_name="",
        status=STATUS_CLOSED,
        reason="Known closed/inactive venue label. Kept unchanged for manual review.",
        confidence="medium",
        evidence_type="curated_registry",
        auto_apply=False,
    ),
}


def normalize(text: str) -> str:
    """Normalize strings for loose matching."""
    text = unicodedata.normalize("NFKC", text)
    text = text.strip()
    text = re.sub(r"\s+", " ", text)
    return text.casefold()


def load_setlist(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"setlist.json not found: {path}")

    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, dict):
        raise ValueError("setlist.json must contain a top-level JSON object")
    if "venues" not in data or not isinstance(data["venues"], list):
        raise ValueError("setlist.json must contain a 'venues' array")

    return data


def build_rule_index() -> Dict[str, Tuple[str, Rule]]:
    indexed: Dict[str, Tuple[str, Rule]] = {}
    for original_key, rule in EXPLICIT_RULES.items():
        indexed[normalize(original_key)] = (original_key, rule)
    return indexed


def classify_venue(name: str, rule_index: Dict[str, Tuple[str, Rule]]) -> dict:
    normalized = normalize(name)

    if normalized in rule_index:
        matched_key, rule = rule_index[normalized]
        return {
            "original": name,
            "matched_rule": matched_key,
            "status": rule.status,
            "suggested_name": rule.suggested_name,
            "reason": rule.reason,
            "evidence_type": rule.evidence_type,
            "confidence": rule.confidence,
            "auto_applied": rule.auto_apply,
        }

    return {
        "original": name,
        "matched_rule": "",
        "status": STATUS_REVIEW,
        "suggested_name": "",
        "reason": "No high-confidence normalization rule matched. Left unchanged.",
        "evidence_type": "none",
        "confidence": "low",
        "auto_applied": False,
    }


def projected_name(result: dict) -> str:
    if result["auto_applied"] and result["suggested_name"]:
        return result["suggested_name"]
    return result["original"]


def mark_duplicate_alias_candidates(results: List[dict]) -> None:
    bucket: Dict[str, List[int]] = {}
    for idx, result in enumerate(results):
        target = normalize(projected_name(result))
        bucket.setdefault(target, []).append(idx)

    for indices in bucket.values():
        if len(indices) < 2:
            continue
        for idx in indices:
            results[idx]["duplicate_after_normalization"] = True
            if results[idx]["status"] == STATUS_REVIEW:
                results[idx]["status"] = STATUS_DUPLICATE
                results[idx]["reason"] = (
                    "Multiple input venue names collapse to the same normalized target. "
                    "Manual review recommended before deleting duplicates."
                )
                results[idx]["confidence"] = "medium"
                results[idx]["evidence_type"] = "internal_normalization"
    for result in results:
        result.setdefault("duplicate_after_normalization", False)


def apply_updates(venues: List[str], results: List[dict]) -> List[str]:
    updated: List[str] = []
    seen = set()

    for original, result in zip(venues, results):
        candidate = projected_name(result)
        key = normalize(candidate)
        if key in seen:
            continue
        seen.add(key)
        updated.append(candidate)

    return updated


def make_summary(results: List[dict], total: int) -> dict:
    counts = Counter(r["status"] for r in results)
    return {
        "total": total,
        STATUS_EXACT: counts.get(STATUS_EXACT, 0),
        STATUS_TYPO: counts.get(STATUS_TYPO, 0),
        STATUS_OLD: counts.get(STATUS_OLD, 0),
        STATUS_CLOSED: counts.get(STATUS_CLOSED, 0),
        STATUS_REVIEW: counts.get(STATUS_REVIEW, 0),
        STATUS_DUPLICATE: counts.get(STATUS_DUPLICATE, 0),
    }


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")


def main() -> int:
    try:
        data = load_setlist(SETLIST_PATH)
        venues = data["venues"]
        if not all(isinstance(v, str) for v in venues):
            raise ValueError("All values in 'venues' must be strings")

        rule_index = build_rule_index()
        results = [classify_venue(v, rule_index) for v in venues]
        mark_duplicate_alias_candidates(results)

        updated_venues = apply_updates(venues, results)
        updated_data = dict(data)
        updated_data["venues"] = updated_venues

        report = {
            "summary": make_summary(results, len(venues)),
            "results": results,
            "stats": {
                "input_count": len(venues),
                "output_count": len(updated_venues),
                "changed": venues != updated_venues,
            },
        }

        write_json(SETLIST_PATH, updated_data)
        write_json(REPORT_PATH, report)

        print("Venue audit completed.")
        print(f"Input venues : {len(venues)}")
        print(f"Output venues: {len(updated_venues)}")
        print(f"Changed      : {venues != updated_venues}")
        return 0

    except Exception as exc:  # pragma: no cover - defensive CLI behavior
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
