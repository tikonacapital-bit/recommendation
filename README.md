# AlphaLens: Multi-Agent Equity Research & Recommendation System

AlphaLens is an institutional-grade, multi-agent financial screening and research platform designed to analyze, score, and rank Indian equities (specifically benchmarked against Nifty 50 and custom watchlists). 

The system operates in two distinct phases:
1. **Phase 1 (Prefilter):** A high-throughput, multi-factor quantitative screening pipeline that ranks stocks across five pillars (Growth, Quality, Valuation, Momentum, Health) using sector-relative and universe-wide percentile scoring.
2. **Phase 2 (Agentic Research):** A LangGraph-orchestrated network of 4 specialist AI agents (Fundamentals, Sector, Sentiment, Valuation) that ingest quantitative financials and qualitative earnings call transcripts (via pgvector RAG) to output a synthesized institutional thesis, fair value targets, and active recommendations.

---

## 1. System Architecture & Technology Stack

The application is split into a decoupled architecture consisting of a Python FastAPI backend and a React (TypeScript) frontend:

```
+-----------------------------------------------------------------------------------+
|                                  React Frontend                                   |
|   (Dashboard, Universe Screener, Real-Time AI Agent Runner, Charts, Predictions)  |
+-----------------------------------------------------------------------------------+
                                         |
                                         | REST API requests (Port 8000)
                                         v
+-----------------------------------------------------------------------------------+
|                                  FastAPI Backend                                  |
|   (Endpoints: /health, /top, /view/{ticker}, /synthesize/{ticker}, /prefilter)     |
+-----------------------------------------------------------------------------------+
       |                                   |                              |
       | Read/Write DB                     | Embeddings (Voyage-3)        | Queue Tasks (Optional)
       v                                   v                              v
+-----------------------+        +-------------------+          +-------------------+
|     Supabase DB       |        | Voyage AI API     |          |   Redis Broker    |
| (PostgreSQL + vector) |        +-------------------+          +-------------------+
+-----------------------+                                                 |
                                                                          v
                                                                +-------------------+
                                                                |   Celery Worker   |
                                                                | (Background runs) |
                                                                +-------------------+
```

- **Frontend Framework:** React (Vite, TypeScript, TailwindCSS for visuals, responsive grid layouts).
- **Backend Engine:** FastAPI (Python 3.10+, Uvicorn server, SQLAlchemy ORM).
- **Database Layer:** Supabase PostgreSQL with the `pgvector` extension for high-performance Vector embeddings storage.
- **LLM & Embeddings Gateway:** OpenRouter/Anthropic API (leveraging Claude & Llama-3.3 models) for specialist agents, and Voyage AI (Voyage-3 model) generating 1024-dimensional semantic vectors.
- **Background Task Scheduler:** Celery with Redis broker (with a fully decoupled fallback to synchronous execution when local Redis is offline).

---

## 2. Database ER Schema

The database stores financial metrics, earnings call chunks, run tracking logs, and model evaluations in the following schema:

| Table Name | Primary / Foreign Keys | Key Columns & Data Types | Functional Purpose |
| :--- | :--- | :--- | :--- |
| **`stocks`** | PK: `id` | `ticker` (String), `name` (String), `sector` (String), `market_cap` (Float), `isin` (String), `is_active` (Boolean) | Stores the core directory of tracked equities. |
| **`financial_models`** | PK: `id`<br>FK: `stock_id` | `period` (String), `data` (JSON), `updated_at` (DateTime) | Stores multi-year balance sheets, P&L statements, cash flows, and key valuation ratios. |
| **`documents`** | PK: `id`<br>FK: `stock_id` | `doc_type` (String), `date` (DateTime), `quarter` (String), `source_url` (Text) | Logs earnings call transcripts, annual reports, and investor presentation files. |
| **`document_chunks`** | PK: `id`<br>FK: `document_id` | `content` (Text), `embedding` (Vector(1024)), `meta_data` (JSON) | Stores Segmented transcript texts. The 1024-dimension embedding enables semantic RAG queries. |
| **`analysis_runs`** | PK: `id` | `timestamp` (DateTime), `status` (String), `total_stocks` (Integer), `processed_count` (Integer), `run_type` (String) | Tracks execution status of the ingestion and prefiltering jobs. |
| **`stock_analysis`** | PK: `id`<br>FK: `stock_id`, `run_id` | `composite_score`, `growth_score`, `durability_score`, `valuation_score`, `technical_score`, `sector_score` (Floats), `thesis_paragraph` (Text), `key_risks` (JSON), `key_catalysts` (JSON), `target_prices` (JSON), `recommendation` (String), `tier_reached` (Integer) | Saves the scored results of both the Phase 1 quantitative screening and the Phase 2 AI Agentic synthesis. |
| **`evidence_registry`** | PK: `id`<br>FK: `analysis_id`, `source_doc_id` | `quote` (Text), `pillar` (String) | Maintains references to exact lines/quotes from concalls to back up the AI agent's sentiment claims. |
| **`prediction_tracking`** | PK: `id`<br>FK: `stock_id`, `analysis_id` | `predicted_price` (Float), `actual_price` (Float), `error_margin` (Float), `evaluated_at` (DateTime) | Audits the system's performance. Tracks error margins of the AI bull/bear targets against real market movements. |

---

## 3. Phase 1: Multi-Factor Quantitative Screening (Prefilter)

To identify high-potential stocks before running expensive LLM operations, Phase 1 scores the entire universe across five distinct financial vectors, using a blend of global and sector-relative percentiles:

1. **Growth (Weight: 25%):** Evaluates revenue CAGR (2-yr, 45% weight), PAT CAGR (2-yr, 35% weight), and forward revenue CAGR (20% weight).
2. **Quality (Weight: 25% - Sector-Relative):** Evaluates ROIC (50% weight), ROE (30% weight), and forward EBITDA margins (20% weight). Sector-relative comparison ensures asset-heavy companies aren't penalized against capital-light software companies.
3. **Valuation (Weight: 20%):** Evaluates consensus upside target (50% weight), forward PE multiple (30% weight, lower is better), and forward EV/EBITDA multiple (20% weight, lower is better). PE and EV/EBITDA are sector-relative.
4. **Momentum (Weight: 15%):** Evaluates 3-month and 6-month historical share price performance.
5. **Financial Health (Weight: 15%):** Evaluates net leverage (inverse ranked, lower leverage gets a higher score, 50% weight), promoter shareholding (30% weight), and asset turnover (20% weight, sector-relative).

### Dynamic Cutoffs & Tiers
Using the composite score calculated from the weighted average of the five pillars, stocks are dynamically grouped into tiers based on universe quantiles:
- **Tier 1 Cutoff:** >= 75th Percentile (minimum score of 55.0)
- **Tier 2 Cutoff:** >= 50th Percentile (minimum score of 48.0)
- **Tier 3 Cutoff:** >= 25th Percentile (minimum score of 40.0)

### Rule-Based Recommendation Mapping

| Recommendation Code | Logic Condition | Operational Meaning |
| :--- | :--- | :--- |
| **`BUY`** | `Composite Score >= 68` AND `Growth Score >= 55` AND `Quality Score >= 55` | Outstanding financial setup. Directly flagged for priority purchase and AI deep dive. |
| **`PASS_TIER_1`** | `Composite Score >= Tier 1 Cutoff` | Top-quartile performer. Passes threshold for Phase 2 Agentic Analysis. |
| **`PASS_TIER_2`** | `Composite Score >= Tier 2 Cutoff` | Median performer. Placed on watchlist. |
| **`PASS_TIER_3`** | `Composite Score >= Tier 3 Cutoff` | Below average but above baseline. Placed on lower watchlist. |
| **`AVOID`** | `Composite Score < 38` | High risk of capital erosion. Poor growth/leverage profiles. |

---

## 4. Phase 2: LangGraph Multi-Agent Research System

Stocks that qualify as Tier 1 are passed to a specialist multi-agent network orchestrated using LangGraph. This network divides research labor among specialized AI personas before fusing their outputs into a final institutional-grade thesis.

*Note: On the free OpenRouter tier, agents execute sequentially (Agent A -> B -> C -> D -> Synthesis) to avoid rate limits. In a paid environment, `SEQUENTIAL_AGENTS = False` can be toggled in `app/agents/graph.py` to restore concurrent execution.*

```
                     +----------------------------+
                     |         START Node         |
                     +----------------------------+
                                   |
         +-------------------------+-------------------------+
         | (Sequential / Parallel Routing based on API Key)  |
         v                                                   v
+-------------------------+                         +-------------------------+
|  Agent A: Fundamentals  |                         |    Agent B: Sector      |
|  - Growth & Balance     |                         |  - Industry KPIs &      |
|    Sheet analysis       |                         |    Competitors          |
+-------------------------+                         +-------------------------+
         |                                                   |
         v                                                   v
+-------------------------+                         +-------------------------+
|   Agent C: Sentiment    |                         |   Agent D: Valuation    |
|  - pgvector RAG on      |                         |  - Target Prices &      |
|    Concalls             |                         |    Risk Audits          |
+-------------------------+                         +-------------------------+
         |                                                   |
         +-------------------------+-------------------------+
                                   v
                     +----------------------------+
                     |      Synthesis Agent       |
                     |  - Combines agent scores   |
                     |  - Caps BUY at HOLD if     |
                     |    subscores fall < 35     |
                     +----------------------------+
                                   |
                                   v
                               [END Node]
```

### The Specialized Agents
1. **Agent A: Fundamentals Analyst**
   Reviews return ratios, net leverage, promoter holding levels, and 2-year CAGRs. Scores *Growth*, *Durability (Quality)*, and *Management Quality* pillars. Alerts on balance sheet leverage stress (Net Debt-to-Equity > 3x).
2. **Agent B: Sector Specialist**
   Reads dynamic industry-specific templates to evaluate sectors using native metrics:
   - *BFSI:* Net Interest Margins (NIM), NPAs, Provision Coverage Ratio (PCR), and CET-1 Capital Adequacy.
   - *IT / Software:* Constant Currency (CC) growth, deal pipeline (TCV), attrition rates, and GenAI commercialization.
   - *Healthcare / Pharma:* USFDA warnings/audits, generic vs. export revenue splits, ANDA approval pipeline.
   - *FMCG / Retail:* Volume vs. value growth, raw materials volatility, quick-commerce expansion.
   - *Industrials / Manufacturing:* Capacity utilization rates, commodity margins, Capex gestation schedules.
3. **Agent C: Management Sentiment (RAG)**
   Queries `pgvector` using a semantic query seeking corporate guidance shifts, tone warnings, and concall red flags. Extracts direct verbatim quotes to prove sentiment claims.
4. **Agent D: Valuation & Risk Auditor**
   Performs multiple-based calculations to set strict Bear, Base, and Bull targets (anchored to current price), and audits liquidity indicators (cash conversion cycles and free float).

### Decision Synthesis & Override Logic
The Synthesis Agent aggregates scores and calculates a unified **Composite Score** using institutional weights:
$$\text{Composite Score} = (\text{Growth} \times 0.30) + (\text{Durability} \times 0.20) + (\text{Management Quality} \times 0.20) + (\text{Sentiment} \times 0.10) + (\text{Valuation} \times 0.10) + (\text{Technical Score} \times 0.10)$$

> [!WARNING]
> **Safety Override Capping:** To ensure high-risk equities are not recommended, if *any* of the individual specialist scores (Growth, Durability, Management Quality, Sentiment, Valuation, Technical) fall below **35**, the final recommendation is immediately capped at **HOLD**, overriding any LLM-proposed **BUY**.

---

## 5. RAG (Retrieval-Augmented Generation) Architecture

AlphaLens integrates RAG to extract qualitative insights from earnings transcripts:
- **Embedding Generation:** High-density Voyage AI (`voyage-3`) model generating 1024-dimensional vector embeddings of partitioned concall texts.
- **Storage:** Supabase PostgreSQL with `pgvector` column format using cosine distance indexes.
- **Query Execution:** A specialized semantic query: `"{ticker} earnings call management sentiment guidance revenue margin trajectory outlook"` is vectorized and compared against the `document_chunks` table.
- **Resilience Fallback:** If the vector search fails, the system executes an automatic chronological fallback to extract the latest 4 transcripts for analysis, preventing LLM failures.

---

## 6. Advanced Multi-Chart & Analytical Workspace

AlphaLens features a highly sophisticated financial charting and analysis terminal built directly into the React interface. This workspace allows analysts to perform rapid visual audits of stock price movements and corporate financial trends side-by-side:

- **TradingView Lightweight Charts Integration:** High-performance canvas-based charting that handles thousands of historical data points with hardware acceleration, providing smooth panning and zoom capabilities.
- **Flexible Layout Grid Modes:**
  - *Single View:* Maximizes a single slot for deep analytical work on a selected ticker.
  - *Split (Dual) View:* Divides the viewport into 2 vertical charts for comparative analysis.
  - *Quad View:* Renders a 4-pane grid displaying four different tickers simultaneously.
  - *All View:* Dynamically loads and renders independent charts for every stock currently passing the active sidebar filters.
- **Multi-Style Chart Support:** Switch on-the-fly between standard Japanese Candlesticks, Line charts, Area charts (with smooth gradient fades), and trend-smoothed Heikin Ashi candles.
- **Timeframe & Period Mapping:** The terminal interfaces with yfinance endpoints, mapping selections to ideal database/API granularities:
  - *Intraday / Short-term (6M, 1Y, 2Y):` Daily candle intervals (1d).
  - *Medium-term (3Y, 5Y):* Weekly candles (1wk).
  - *Long-term (10Y, Max):* Monthly candles (1mo).
- **Real-Time HUD & Interactive Tooltips:** A floating Heads-Up Display (HUD) overlay shows real-time Open, High, Low, Close, and Volume (OHLCV) values, along with absolute and percentage price changes, updating dynamically as the user hovers over the chart.
- **Fullscreen Presenter Mode:** Select multiple stocks via checkboxes to launch a distraction-free, full-screen grid presenter mode.
- **Universal Filtering Sidebar:** Sidebar controls filter the chartable universe by name/ticker search, sector category, and customizable Market Cap ranges (in Rupees Crores).

---

## 7. Interactive React Frontend Interface

The React web application provides an intuitive dashboard for analyzing data:
1. **Dashboard View:** Displays visual gauges for the composite score, detailed progress reports from the four agents, final investment thesis, target prices, and evidence quotes.
2. **Universe Screener:** Interactive grid displaying all stocks in the database, complete with search, sector filters, tier classifications, and color-coded scores.
3. **Real-Time AI Analyze View:** Initiates LangGraph agent execution in real-time, displaying a live terminal log as each specialist finishes.
4. **Pipeline View:** A management control center to trigger Database Syncs, run Multi-Factor screens, and monitor background queue states.
5. **Charts View:** Integrates a Candlestick stock price chart alongside an interactive 4-period financial metrics chart (FY23, FY24, FY25, TTM) for comparing Revenue, EBITDA, and PAT.
6. **Predictions Audit View:** Computes the accuracy of past recommendation targets against real-time actual prices to track model drift.

---

## 8. Setup & Run Instructions

To run the system locally, execute the following commands:

### Prerequisites & Environment
Create a `.env` file in the project root with the following keys:
```env
DATABASE_URL=postgresql+psycopg2://postgres.[REF]:[PASS]@[HOST]:6543/postgres?sslmode=require
OPENROUTER_API_KEY=your_key_here
VOYAGE_API_KEY=your_key_here
```

### Initialize & Run Backend
```powershell
# Install Python dependencies
pip install -r requirements.txt

# Verify database connection
python -m app.core.check_db

# Initialize database schema and tables
python -m app.core.init_db

# Run FastAPI backend (starts on http://127.0.0.1:8000)
python -m uvicorn app.main:app --reload
```

### Run Celery Worker (Optional for Background Syncs)
```powershell
# In a separate terminal
celery -A app.core.celery_app.celery_app worker --loglevel=info --pool=solo
```
*Note: On Windows, `--pool=solo` avoids multiprocessing issues during local development.*

### Run Frontend Dev Server
```powershell
# Navigate to frontend folder
cd frontend

# Install package dependencies
npm install

# Run the local Vite dev server (starts on http://localhost:5173)
npm run dev
```

---
AlphaLens Multi-Agent Equity Research & Recommendation System © 2026. All Rights Reserved.
