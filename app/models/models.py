from sqlalchemy import Column, Integer, String, JSON, Float, ForeignKey, DateTime, Text, Boolean, UniqueConstraint
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.sql import func
try:
    from pgvector.sqlalchemy import Vector
except ModuleNotFoundError:
    from sqlalchemy.types import UserDefinedType

    class Vector(UserDefinedType):
        cache_ok = True

        def __init__(self, dimensions: int):
            self.dimensions = dimensions

        def get_col_spec(self, **kw):
            return f"VECTOR({self.dimensions})"

Base = declarative_base()

class Stock(Base):
    __tablename__ = "stocks"
    
    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String(20), unique=True, index=True, nullable=False)
    name = Column(String(255))
    sector = Column(String(100), index=True)
    market_cap = Column(Float)
    isin = Column(String(20), unique=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    financial_models = relationship("FinancialModel", back_populates="stock")
    documents = relationship("Document", back_populates="stock")
    analyses = relationship("StockAnalysis", back_populates="stock")

class FinancialModel(Base):
    __tablename__ = "financial_models"
    __table_args__ = (
        UniqueConstraint("stock_id", "period", name="uq_financial_model_stock_period"),
    )
    
    id = Column(Integer, primary_key=True, index=True)
    stock_id = Column(Integer, ForeignKey("stocks.id"), nullable=False)
    period = Column(String(20)) # e.g., "FY2024Q3"
    data = Column(JSON) # Multi-year P&L, BS, CF
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    stock = relationship("Stock", back_populates="financial_models")

class Document(Base):
    __tablename__ = "documents"
    
    id = Column(Integer, primary_key=True, index=True)
    stock_id = Column(Integer, ForeignKey("stocks.id"), nullable=False)
    doc_type = Column(String(50)) # "concall", "ppt", "annual_report"
    date = Column(DateTime)
    quarter = Column(String(10))
    source_url = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    stock = relationship("Stock", back_populates="documents")
    chunks = relationship("DocumentChunk", back_populates="document")

class DocumentChunk(Base):
    __tablename__ = "document_chunks"
    
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False)
    content = Column(Text, nullable=False)
    embedding = Column(Vector(1024)) # Voyage-3 outputs 1024-dimensional vectors
    meta_data = Column(JSON)
    
    document = relationship("Document", back_populates="chunks")

class AnalysisRun(Base):
    __tablename__ = "analysis_runs"
    
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    status = Column(String(50)) # "started", "completed", "failed"
    total_stocks = Column(Integer)
    processed_count = Column(Integer, default=0)
    cost_estimate = Column(Float, default=0.0)
    run_type = Column(String(50), default="prefilter") # "prefilter", "agent", "full_pipeline"
    error_message = Column(Text)
    completed_at = Column(DateTime(timezone=True))

    analyses = relationship("StockAnalysis", back_populates="run")

class StockAnalysis(Base):
    __tablename__ = "stock_analysis"
    __table_args__ = (
        UniqueConstraint("stock_id", "run_id", name="uq_stock_analysis_stock_run"),
    )
    
    id = Column(Integer, primary_key=True, index=True)
    stock_id = Column(Integer, ForeignKey("stocks.id"), nullable=False)
    run_id = Column(Integer, ForeignKey("analysis_runs.id"), nullable=False)
    
    # Scores
    composite_score = Column(Float)
    growth_score = Column(Float)
    durability_score = Column(Float)
    mgmt_quality_score = Column(Float)
    mgmt_sentiment_score = Column(Float)
    valuation_score = Column(Float)
    technical_score = Column(Float)
    sector_score = Column(Float)
    
    # Content
    thesis_paragraph = Column(Text)
    key_risks = Column(JSON) # List of risks
    key_catalysts = Column(JSON)
    target_prices = Column(JSON) # {bull, base, bear}
    agent_outputs = Column(JSON) # Structured outputs from Agent A/B/C/D before synthesis
    recommendation = Column(String(20)) # BUY, HOLD, AVOID, etc.
    
    # Metadata
    tier_reached = Column(Integer) # 1 or 2
    rank_in_universe = Column(Integer)
    rank_change_wow = Column(Integer)
    confidence_score = Column(Float)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    stock = relationship("Stock", back_populates="analyses")
    run = relationship("AnalysisRun", back_populates="analyses")

class EvidenceRegistry(Base):
    __tablename__ = "evidence_registry"
    
    id = Column(Integer, primary_key=True, index=True)
    analysis_id = Column(Integer, ForeignKey("stock_analysis.id"), nullable=False)
    quote = Column(Text)
    source_doc_id = Column(Integer, ForeignKey("documents.id"))
    pillar = Column(String(50)) # e.g., "Management Quality"
    
    analysis = relationship("StockAnalysis")

class PredictionTracking(Base):
    __tablename__ = "prediction_tracking"
    
    id = Column(Integer, primary_key=True, index=True)
    stock_id = Column(Integer, ForeignKey("stocks.id"), nullable=False)
    analysis_id = Column(Integer, ForeignKey("stock_analysis.id"), nullable=False)
    predicted_price = Column(Float)
    actual_price = Column(Float)
    error_margin = Column(Float)
    evaluated_at = Column(DateTime)
