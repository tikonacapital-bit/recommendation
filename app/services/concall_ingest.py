import logging
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from app.models.models import Stock, Document, DocumentChunk
from app.services.embeddings import get_embedding

logger = logging.getLogger(__name__)

def chunk_text(text: str, chunk_size_words: int = 400, overlap_words: int = 50) -> list[str]:
    """
    Splits text into overlapping chunks of a given word length.
    """
    words = text.split()
    chunks = []
    if not words:
        return chunks
        
    i = 0
    while i < len(words):
        # Grab chunk_size_words
        chunk_words = words[i : i + chunk_size_words]
        chunks.append(" ".join(chunk_words))
        # Advance by size minus overlap
        i += chunk_size_words - overlap_words
        # Avoid infinite loop if overlap is larger than size
        if chunk_size_words <= overlap_words:
            break
            
    return chunks

def ingest_concall_text(
    db: Session, 
    ticker: str, 
    quarter: str, 
    doc_date: datetime, 
    text_content: str, 
    doc_type: str = "concall"
) -> Document:
    """
    Ingests raw concall transcript text:
    1. Resolves/verifies the Stock in the database.
    2. Creates a Document record.
    3. Chunks the text into overlapping segments.
    4. Generates 1024-dimensional embeddings for each chunk.
    5. Saves DocumentChunks linked to the Document with vector embeddings.
    """
    # 1. Find the stock
    stock = db.query(Stock).filter(Stock.ticker == ticker.upper()).first()
    if not stock:
        raise LookupError(f"Stock ticker {ticker} not found in database. Ingest stock data first.")
        
    logger.info(f"Ingesting {doc_type} for {ticker} ({quarter})...")
    
    # 2. Create and commit Document
    doc = Document(
        stock_id=stock.id,
        doc_type=doc_type,
        date=doc_date,
        quarter=quarter,
        source_url=f"internal://{ticker.lower()}/{quarter.lower()}/{doc_type}"
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    
    # 3. Chunk text
    chunks = chunk_text(text_content)
    logger.info(f"Split document into {len(chunks)} chunks.")
    
    # 4. Generate embeddings and save chunks
    for idx, chunk_text_content in enumerate(chunks):
        embedding_vector = get_embedding(chunk_text_content)
        
        meta = {
            "chunk_index": idx,
            "char_count": len(chunk_text_content),
            "word_count": len(chunk_text_content.split()),
            "ticker": ticker.upper(),
            "quarter": quarter
        }
        
        chunk_record = DocumentChunk(
            document_id=doc.id,
            content=chunk_text_content,
            embedding=embedding_vector,
            meta_data=meta
        )
        db.add(chunk_record)
        
    db.commit()
    logger.info(f"Successfully saved {len(chunks)} chunks for document {doc.id}.")
    return doc

# High-fidelity mock transcripts matching business realities of major Indian stocks
MOCK_TRANSCRIPTS = {
    "TCS.NS": {
        "quarter": "FY26Q1",
        "date": datetime(2025, 7, 15, tzinfo=timezone.utc),
        "content": (
            "Tata Consultancy Services Limited (TCS) FY26Q1 Earnings Concall Transcript.\n"
            "Key speakers: Mr. K. Krithivasan (CEO & MD), Mr. Samir Seksaria (CFO).\n"
            "Executive Summary: TCS reported solid revenue growth of 2.1% QoQ in constant currency, led by "
            "continued expansion in our digital transformation and cloud migration pipeline. Operating margins "
            "expanded by 40 basis points to 24.7% despite headwind pressures from our annual wage hikes, reflecting "
            "strong operational efficiencies and higher offshore delivery utilization. Deal wins reached an all-time "
            "high of $10.2 billion this quarter, driven by three mega-deals in Europe and massive adoption of "
            "generative AI pilots moving into production scale.\n\n"
            "Management Commentary on Generative AI: CEO Krithivasan stated, 'We are seeing extraordinary traction "
            "in our AI-first offerings. Our generative AI pipeline has doubled to over $1.5 billion this quarter. "
            "We have moved beyond simple proofs of concept to enterprise-wide deployments. For a major global bank, "
            "we deployed an AI-driven automated customer service agent that successfully handles over 80% of routine "
            "queries, reducing operational overhead by 45%.'\n\n"
            "Guidance & Margins: CFO Seksaria commented on margins: 'Our operating margin resilience is a testament "
            "to our disciplined execution. We have maintained our target range of 25-26% for the full year. While "
            "onshore payroll remains tight, we have successfully optimized our subcontractor costs and expanded our "
            "offshore delivery capability. Attrition has normalized further to a healthy 11.2%, giving us excellent "
            "control over delivery costs. Our order book is highly resilient, and our deal win book-to-bill ratio "
            "stands at a comfortable 1.25x. We are confident in our double-digit growth trajectory.'"
        )
    },
    "RELIANCE.NS": {
        "quarter": "FY26Q1",
        "date": datetime(2025, 7, 20, tzinfo=timezone.utc),
        "content": (
            "Reliance Industries Limited (RIL) FY26Q1 Earnings Concall Transcript.\n"
            "Key speakers: Mr. Mukesh Ambani (Chairman), Mr. Srikanth Venkatachari (CFO).\n"
            "Executive Summary: Reliance delivered strong performance across all core engines. Consolidated EBITDA "
            "reached a record high, driven by the telecom and retail segments, which offset structural margins softening "
            "in the Oil-to-Chemicals (O2C) petrochemicals business. Telecom sector (Jio) reported stellar subscriber additions "
            "of 12.5 million, raising active subscriber base. Jio ARPU (Average Revenue Per User) grew by 4.2% QoQ to Rs. 188.5, "
            "reflecting the high-tariff 5G migration. Reliance Retail EBITDA grew 18% YoY, led by rapid physical footprint "
            "expansion and digital commerce channels now accounting for 18% of total retail sales.\n\n"
            "Petrochemicals O2C Margin Commentary: CFO Venkatachari noted, 'O2C margins faced localized pressure due to "
            "subdued refining cracks in gasoline and high feedstock prices. However, our high integration allowed us to redirect "
            "intermediate streams and maximize higher-value polymers, maintaining a healthy premium over benchmark Singapore cracks. "
            "Our green energy projects are on track, with the first gigafactory for solar PV panels starting trial production in "
            "Jamnagar this quarter.'\n\n"
            "Telecom & Retail Traction: Chairman Ambani noted, 'Our 5G network rollout is fully completed. Jio is now "
            "capturing over 85% of incremental 5G traffic in India. Reliance Retail has added over 300 new stores this quarter, "
            "taking our total footprint to 18,900 stores. Net debt to EBITDA is highly stable at 1.1x, and our capital expenditure "
            "cycle is peaking. We are well-positioned to drive substantial compounding cash flows.'"
        )
    },
    "INFY.NS": {
        "quarter": "FY26Q1",
        "date": datetime(2025, 7, 18, tzinfo=timezone.utc),
        "content": (
            "Infosys Limited FY26Q1 Earnings Concall Transcript.\n"
            "Key speakers: Mr. Salil Parekh (CEO), Mr. Jayesh Sanghrajka (CFO).\n"
            "Executive Summary: Infosys delivered constant-currency revenue growth of 1.7% QoQ. Operating margins stood "
            "at 21.1%, flat QoQ. Large deal TCV (Total Contract Value) was reported at a robust $3.4 billion, comprising "
            "18 large deals, 45% of which were net new. The company revised its full-year constant-currency revenue guidance "
            "upward to 4.5% - 6.5% (from 4.0% - 6.0%), reflecting strong visibility and robust client engagement across digital "
            "banking, automotive, and sustainability services.\n\n"
            "Generative AI & Cloud Expansion: CEO Parekh remarked, 'We are seeing strong demand for our Infosys Topaz "
            "platform. Our clients are integrating AI into cloud transformations. We recently signed a major $800 million "
            "strategic partnership with an international aerospace giant to modernize their legacy operations and embed "
            "AI across engineering and supply chain, improving speed-to-market by 35%.'\n\n"
            "Subcontractor Costs and Attrition: CFO Sanghrajka added, 'We continue to drive margin improvements through our "
            "Project Maximus cost optimization program. We have successfully replaced expensive third-party subcontractors with "
            "in-house trained engineers, improving our utilization rate to 85.5%. Attrition stood at a stable 12.3%. "
            "Our net cash position is extremely strong at $3.2 billion, enabling a robust capital allocation policy.'"
        )
    }
}

def seed_mock_concalls(db: Session, tickers: list[str] = None) -> int:
    """
    Seeds mock transcripts for testing.
    Returns the number of documents seeded.
    """
    if not tickers:
        tickers = list(MOCK_TRANSCRIPTS.keys())
        
    seeded = 0
    for ticker in tickers:
        normalized_ticker = ticker.upper()
        if normalized_ticker not in MOCK_TRANSCRIPTS:
            continue
            
        # Check if stock exists in database
        stock = db.query(Stock).filter(Stock.ticker == normalized_ticker).first()
        if not stock:
            logger.info(f"Skipping seeding of mock concall for {normalized_ticker} — stock record not found in DB.")
            continue
            
        # Check if document already exists
        mock_data = MOCK_TRANSCRIPTS[normalized_ticker]
        existing = db.query(Document).filter(
            Document.stock_id == stock.id,
            Document.quarter == mock_data["quarter"],
            Document.doc_type == "concall"
        ).first()
        
        if existing:
            logger.info(f"Concall document for {normalized_ticker} ({mock_data['quarter']}) already exists. Skipping.")
            continue
            
        try:
            ingest_concall_text(
                db=db,
                ticker=normalized_ticker,
                quarter=mock_data["quarter"],
                doc_date=mock_data["date"],
                text_content=mock_data["content"]
            )
            seeded += 1
        except Exception as e:
            logger.error(f"Error seeding mock concall for {normalized_ticker}: {e}")
            
    return seeded

if __name__ == "__main__":
    from app.core.db import SessionLocal
    logging.basicConfig(level=logging.INFO)
    db = SessionLocal()
    try:
        # Seed all
        print("Seeding mock concalls into the database...")
        seeded = seed_mock_concalls(db)
        print(f"Seeding completed. Seeded {seeded} documents.")
    finally:
        db.close()
