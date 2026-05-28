import os
import logging
from dotenv import load_dotenv
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes
from sqlalchemy import desc, func
from app.core.db import SessionLocal
from app.models.models import Stock, StockAnalysis

# Configure logging
logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s", level=logging.INFO
)
logger = logging.getLogger(__name__)

# Load absolute .env path
env_path = r"c:\Users\YADAV KISHAN KUMAR\OneDrive\Desktop\recommendation\.env"
load_dotenv(dotenv_path=env_path)

def get_db_session():
    return SessionLocal()

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Send a friendly welcome message showing active research terminal commands."""
    welcome_text = (
        "🤖 *AlphaLens Equity Research Terminal Bot*\n\n"
        "Welcome! I am your mobile assistant connected directly to the AlphaLens multi-agent research universe. "
        "I query your Supabase database in real-time to retrieve professional scored stock reports.\n\n"
        "📈 *Available Commands*:\n"
        "• `/top` — Retrieve the top 5 stock picks sorted by composite score.\n"
        "• `/view [ticker]` — View detailed investment thesis, target prices, and risks (e.g. `/view TCS.NS` or `/view Reliance`).\n"
        "• `/sectors` — Show a summary of covered sectors and stock counts.\n\n"
        "*Tip*: You can run the bot in the background to access stock recommendations anytime!"
    )
    await update.message.reply_text(welcome_text, parse_mode="Markdown")

async def top(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """List the top 5 stock picks sorted by composite score."""
    db = get_db_session()
    try:
        # Get the latest analysis per stock
        latest_sub = (
            db.query(func.max(StockAnalysis.id).label("latest_id"))
            .group_by(StockAnalysis.stock_id)
            .subquery()
        )
        
        results = (
            db.query(StockAnalysis)
            .join(latest_sub, StockAnalysis.id == latest_sub.c.latest_id)
            .join(Stock)
            .order_by(desc(StockAnalysis.composite_score))
            .limit(5)
            .all()
        )
        
        if not results:
            await update.message.reply_text("📭 No stock analysis records found. Seed data and run step 1 first!")
            return
            
        msg = "🏆 *Top 5 Scored Stock Picks*:\n\n"
        for i, item in enumerate(results, 1):
            ticker_clean = item.stock.ticker.removesuffix(".NS")
            msg += (
                f"{i}. *{ticker_clean}* | Sector: `{item.stock.sector}`\n"
                f"   Score: *{item.composite_score:.1f}* | Rec: *{item.recommendation}* (Accuracy: {int(item.confidence_score * 100)}%)\n\n"
            )
        await update.message.reply_text(msg, parse_mode="Markdown")
    except Exception as e:
        logger.error(f"Error in /top command: {e}")
        await update.message.reply_text("❌ Database query error occurred.")
    finally:
        db.close()

async def view(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """View details for a specific stock ticker."""
    if not context.args:
        await update.message.reply_text("⚠️ Please specify a stock ticker symbol. Example: `/view TCS.NS` or `/view Reliance`")
        return
        
    query_ticker = context.args[0].upper().strip()
    if not query_ticker.endswith(".NS") and not query_ticker.endswith(".BO"):
        # Automatically default to NSE for ease of use
        query_ticker += ".NS"
        
    db = get_db_session()
    try:
        # Search for stock
        stock = db.query(Stock).filter(Stock.ticker.ilike(f"%{query_ticker}%")).first()
        if not stock:
            # Try fuzzy search by name
            raw_arg = context.args[0]
            stock = db.query(Stock).filter(Stock.name.ilike(f"%{raw_arg}%")).first()
            
        if not stock:
            await update.message.reply_text(f"🔍 Stock '{context.args[0]}' not found in database.")
            return
            
        # Get latest analysis
        analysis = (
            db.query(StockAnalysis)
            .filter(StockAnalysis.stock_id == stock.id)
            .order_by(desc(StockAnalysis.created_at))
            .first()
        )
        
        if not analysis:
            await update.message.reply_text(f"📂 Stock '{stock.ticker}' is tracked, but no analysis has been generated yet.")
            return
            
        ticker_clean = stock.ticker.removesuffix(".NS")
        bear = analysis.target_prices.get("bear", 0.0) if analysis.target_prices else 0.0
        base = analysis.target_prices.get("base", 0.0) if analysis.target_prices else 0.0
        bull = analysis.target_prices.get("bull", 0.0) if analysis.target_prices else 0.0
        
        risks = analysis.key_risks or []
        catalysts = analysis.key_catalysts or []
        
        report = (
            f"📊 *AlphaLens Scored Report: {ticker_clean}*\n"
            f"Company: `{stock.name}`\n"
            f"Sector: `{stock.sector}`\n\n"
            f"📈 *Composite Score*: *{analysis.composite_score:.1f}/100*\n"
            f"🏷️ *Recommendation*: *{analysis.recommendation}* (Tier: {analysis.tier_reached or 'N/A'})\n"
            f"🎯 *Confidence Level*: *{int(analysis.confidence_score * 100)}%*\n\n"
            f"📝 *Investment Thesis*:\n_{analysis.thesis_paragraph}_\n\n"
            f"🎯 *Fair Value Targets (INR)*:\n"
            f"• 🐻 Bear Target: `₹{bear:.1f}`\n"
            f"• 📈 Base Target: `₹{base:.1f}`\n"
            f"• 🐂 Bull Target: `₹{bull:.1f}`\n\n"
            f"⚠️ *Key Risks*:\n" + ("\n".join([f"- {r}" for r in risks[:3]]) if risks else "- No major risks logged.") + "\n\n"
            f"⚡ *Key Catalysts*:\n" + ("\n".join([f"- {c}" for c in catalysts[:3]]) if catalysts else "- No major catalysts logged.")
        )
        await update.message.reply_text(report, parse_mode="Markdown")
    except Exception as e:
        logger.error(f"Error in /view command: {e}")
        await update.message.reply_text("❌ Database query error occurred.")
    finally:
        db.close()

async def sectors(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show a summary of covered sectors and stock counts."""
    db = get_db_session()
    try:
        results = (
            db.query(Stock.sector, func.count(Stock.id))
            .filter(Stock.is_active == True)
            .group_by(Stock.sector)
            .order_by(desc(func.count(Stock.id)))
            .all()
        )
        
        if not results:
            await update.message.reply_text("📭 No tracked sectors found in the database.")
            return
            
        msg = "📂 *Covered Sectors Summary*:\n\n"
        for sector, count in results:
            if sector:
                msg += f"• `{sector}`: *{count}* stocks\n"
        await update.message.reply_text(msg, parse_mode="Markdown")
    except Exception as e:
        logger.error(f"Error in /sectors command: {e}")
        await update.message.reply_text("❌ Database query error occurred.")
    finally:
        db.close()

def main():
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    if not token or "your_telegram_bot_token" in token.lower():
        print("\n" + "="*70)
        print("⚠️  TELEGRAM_BOT_TOKEN is not configured in your .env file!")
        print("To configure your Telegram Research Bot:")
        print("1. Search for @BotFather on Telegram.")
        print("2. Send '/newbot' and follow instructions to get an API Token.")
        print("3. Add TELEGRAM_BOT_TOKEN=your_token_here to your .env file.")
        print("4. Restart this script.")
        print("="*70 + "\n")
        return
        
    print(f"🤖 Starting AlphaLens Telegram Research Bot...")
    app = Application.builder().token(token).build()

    # Register Command Handlers
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("top", top))
    app.add_handler(CommandHandler("view", view))
    app.add_handler(CommandHandler("sectors", sectors))

    # Run bot
    app.run_polling()

if __name__ == "__main__":
    main()
