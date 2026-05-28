import os
import logging
import hashlib
import requests
import numpy as np
from typing import Any, List

logger = logging.getLogger(__name__)

def generate_fallback_embedding(text: str) -> list[float]:
    """
    Deterministic random projection vectorizer (1024 dimensions).
    Acts as a lightweight, zero-dependency local fallback for semantic retrieval.
    Words are deterministically hashed and projected into a 1024-dimensional space.
    """
    if not text:
        return [0.0] * 1024
        
    words = text.lower().split()
    vector = np.zeros(1024)
    for word in words:
        # Get a deterministic 32-bit integer seed from the word's SHA-256 hash
        h = hashlib.sha256(word.encode('utf-8')).digest()
        seed = int.from_bytes(h, byteorder='big') % 2**32
        rng = np.random.default_rng(seed)
        
        # Add a random projection vector for this word
        vector += rng.normal(size=1024)
        
    # L2 normalize the resulting vector
    norm = np.linalg.norm(vector)
    if norm > 0:
        vector = vector / norm
        
    return vector.tolist()

def get_embeddings(texts: list[str]) -> list[list[float]]:
    """
    Generates 1024-dimensional embeddings for a list of texts.
    Prioritizes Voyage-3 via Voyage REST API, falling back to deterministic projections on error or unconfigured key.
    """
    api_key = os.getenv("VOYAGE_API_KEY", "").strip()
    is_placeholder = not api_key or "your_voyage_key" in api_key.lower() or api_key == ""
    
    if is_placeholder:
        logger.info("VOYAGE_API_KEY is not configured or is a placeholder. Using deterministic random projection embeddings.")
        return [generate_fallback_embedding(t) for t in texts]
        
    try:
        response = requests.post(
            "https://api.voyageai.com/v1/embeddings",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "input": texts,
                "model": "voyage-3",
            },
            timeout=30
        )
        response.raise_for_status()
        data = response.json()
        return [item["embedding"] for item in data["data"]]
    except Exception as exc:
        logger.warning(f"Voyage embedding API call failed: {exc}. Falling back to deterministic random projection.")
        return [generate_fallback_embedding(t) for t in texts]

def get_embedding(text: str) -> list[float]:
    """Utility to fetch embedding for a single text string."""
    return get_embeddings([text])[0]
