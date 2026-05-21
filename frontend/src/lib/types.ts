export interface StockAnalysis {
  ticker: string;
  name: string | null;
  sector: string | null;
  composite_score: number | null;
  growth_score: number | null;
  durability_score: number | null;
  mgmt_quality_score: number | null;
  mgmt_sentiment_score: number | null;
  valuation_score: number | null;
  technical_score: number | null;
  sector_score: number | null;
  recommendation: string | null;
  thesis_paragraph: string | null;
  key_risks: string[];
  key_catalysts: string[];
  target_prices: Record<string, number>;
  tier_reached: number | null;
  rank_in_universe: number | null;
  confidence_score: number | null;
  agent_outputs: Record<string, unknown>;
  created_at: string;
  id?: number;
}

export interface TopResponse {
  count: number;
  results: StockAnalysis[];
}

export interface HealthResponse {
  status: string;
  database: string;
}

export interface TaskResponse {
  status: string;
  task_id?: string;
  message?: string;
}

export interface RunResponse {
  run_id: number;
  status: string;
  total_stocks: number;
  processed_count: number;
}

export interface Evidence {
  id: number;
  quote: string;
  pillar: string | null;
  source_doc_id: number | null;
}

export interface Prediction {
  id: number;
  analysis_id: number;
  predicted_price: number;
  actual_price: number;
  error_margin: number;
  evaluated_at: string;
}
