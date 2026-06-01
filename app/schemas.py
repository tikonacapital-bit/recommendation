from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class HealthResponse(BaseModel):
    status: str
    database: str


class RefreshResponse(BaseModel):
    status: str
    ticker: str
    message: str
    task_id: str | None = None


class RunResponse(BaseModel):
    run_id: int
    status: str
    total_stocks: int
    processed_count: int


class TaskResponse(BaseModel):
    status: str
    task_id: str | None = None
    message: str


class StockSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    ticker: str
    name: str | None = None
    sector: str | None = None
    market_cap: float | None = None


class StockAnalysisResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    ticker: str
    name: str | None = None
    sector: str | None = None
    market_cap: float | None = None
    composite_score: float | None = None
    growth_score: float | None = None
    durability_score: float | None = None
    mgmt_quality_score: float | None = None
    mgmt_sentiment_score: float | None = None
    valuation_score: float | None = None
    technical_score: float | None = None
    sector_score: float | None = None
    recommendation: str | None = None
    thesis_paragraph: str | None = None
    key_risks: list[str] = Field(default_factory=list)
    key_catalysts: list[str] = Field(default_factory=list)
    target_prices: dict[str, Any] = Field(default_factory=dict)
    tier_reached: int | None = None
    rank_in_universe: int | None = None
    confidence_score: float | None = None
    agent_outputs: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None


class TopResponse(BaseModel):
    count: int
    results: list[StockAnalysisResponse]
