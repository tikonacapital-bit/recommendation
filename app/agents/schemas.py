from typing import Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator


Score = float


class EvidenceItem(BaseModel):
    source: str = ""
    quote: str = ""
    pillar: str = ""

    @classmethod
    def from_any(cls, value) -> "EvidenceItem":
        """Accept either a dict or a bare string from the LLM."""
        if isinstance(value, str):
            return cls(quote=value)
        if isinstance(value, dict):
            return cls(**{k: str(v) for k, v in value.items() if k in {"source", "quote", "pillar"}})
        return cls()


class FundamentalsOutput(BaseModel):
    growth_score: Score = Field(default=50.0, ge=0, le=100)
    durability_score: Score = Field(default=50.0, ge=0, le=100)
    mgmt_quality_score: Score = Field(default=50.0, ge=0, le=100)
    summary: str = ""
    internal_tensions: list[str] = Field(default_factory=list)
    evidence: list[EvidenceItem] = Field(default_factory=list)

    @field_validator("evidence", mode="before")
    @classmethod
    def coerce_evidence(cls, v):
        return [EvidenceItem.from_any(i) for i in v] if isinstance(v, list) else []


class SectorSpecialistOutput(BaseModel):
    sector: str = "General"
    sector_score: Score = Field(default=50.0, ge=0, le=100)
    sector_kpis: dict[str, Union[float, str, None]] = Field(default_factory=dict)
    summary: str = ""
    evidence: list[EvidenceItem] = Field(default_factory=list)

    @field_validator("evidence", mode="before")
    @classmethod
    def coerce_evidence(cls, v):
        return [EvidenceItem.from_any(i) for i in v] if isinstance(v, list) else []


_TONE_SHIFT_MAP = {
    "improving": "improving", "improved": "improving", "positive": "improving",
    "stable": "stable", "neutral": "stable", "steady": "stable",
    "deteriorating": "deteriorating", "negative": "deteriorating", "declining": "deteriorating",
}

_GUIDANCE_MAP = {
    "raised": "raised", "upgraded": "raised", "raised guidance": "raised",
    "maintained": "maintained", "reiterated": "maintained", "unchanged": "maintained",
    "lowered": "lowered", "reduced": "lowered", "cut": "lowered",
}


class ManagementSentimentOutput(BaseModel):
    mgmt_sentiment_score: Score = Field(default=50.0, ge=0, le=100)
    tone_shift: Literal["improving", "stable", "deteriorating", "unknown"] = "unknown"
    guidance_change: Literal["raised", "maintained", "lowered", "unknown"] = "unknown"
    red_flags: list[str] = Field(default_factory=list)
    summary: str = ""
    evidence: list[EvidenceItem] = Field(default_factory=list)

    @field_validator("tone_shift", mode="before")
    @classmethod
    def normalize_tone(cls, v):
        if not isinstance(v, str):
            return "unknown"
        key = v.strip().lower()
        return _TONE_SHIFT_MAP.get(key, "unknown")

    @field_validator("guidance_change", mode="before")
    @classmethod
    def normalize_guidance(cls, v):
        if not isinstance(v, str):
            return "unknown"
        key = v.strip().lower()
        # Try exact match first, then partial
        if key in _GUIDANCE_MAP:
            return _GUIDANCE_MAP[key]
        for pattern, val in _GUIDANCE_MAP.items():
            if pattern in key:
                return val
        return "unknown"

    @field_validator("evidence", mode="before")
    @classmethod
    def coerce_evidence(cls, v):
        return [EvidenceItem.from_any(i) for i in v] if isinstance(v, list) else []


class ValuationRiskOutput(BaseModel):
    valuation_score: Score = Field(default=50.0, ge=0, le=100)
    target_prices: dict[str, float] = Field(default_factory=lambda: {"bear": 0.0, "base": 0.0, "bull": 0.0})
    risk_flags: list[str] = Field(default_factory=list)
    accounting_flags: list[str] = Field(default_factory=list)
    liquidity_flags: list[str] = Field(default_factory=list)
    summary: str = ""
    evidence: list[EvidenceItem] = Field(default_factory=list)

    @field_validator("evidence", mode="before")
    @classmethod
    def coerce_evidence(cls, v):
        return [EvidenceItem.from_any(i) for i in v] if isinstance(v, list) else []

    @field_validator("target_prices", mode="before")
    @classmethod
    def normalize_target_prices(cls, v):
        if not isinstance(v, dict):
            return {"bear": 0.0, "base": 0.0, "bull": 0.0}
        result = {"bear": 0.0, "base": 0.0, "bull": 0.0}
        for key, val in v.items():
            lk = key.lower()
            if lk in result:
                try:
                    result[lk] = float(val)
                except (TypeError, ValueError):
                    pass
        return result


_RECOMMENDATION_MAP = {
    "buy": "BUY", "strong buy": "BUY", "outperform": "BUY",
    "hold": "HOLD", "neutral": "HOLD", "market perform": "HOLD",
    "avoid": "AVOID", "sell": "AVOID", "underperform": "AVOID", "reduce": "AVOID",
    "rank_only": "RANK_ONLY", "rank only": "RANK_ONLY",
}


class SynthesisOutput(BaseModel):
    composite_score: Score = Field(default=50.0, ge=0, le=100)
    recommendation: Literal["BUY", "HOLD", "AVOID", "RANK_ONLY"] = "RANK_ONLY"
    thesis_paragraph: str = ""
    key_risks: list[str] = Field(default_factory=list)
    key_catalysts: list[str] = Field(default_factory=list)
    target_prices: dict[str, float] = Field(default_factory=lambda: {"bear": 0.0, "base": 0.0, "bull": 0.0})
    confidence_score: Score = Field(default=50.0, ge=0, le=100)

    @field_validator("recommendation", mode="before")
    @classmethod
    def normalize_recommendation(cls, v):
        if not isinstance(v, str):
            return "RANK_ONLY"
        key = v.strip().lower()
        return _RECOMMENDATION_MAP.get(key, "RANK_ONLY")
