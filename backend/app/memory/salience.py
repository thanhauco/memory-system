import re
import math
from typing import List
from sqlalchemy.orm import Session
from ..models import EpisodicMemory

# Simple list of words indicating high importance, goals, or critical events
IMPORTANCE_KEYWORDS = [
    r"\b(decided|resolved|determined|planned)\b",
    r"\b(important|critical|essential|vital|key|crucial)\b",
    r"\b(must|should|need|ought)\b",
    r"\b(learned|realized|discovered|understood|found)\b",
    r"\b(goal|objective|target|milestone|deadline)\b",
    r"\b(fail|failed|failure|success|succeeded|won|lost)\b",
    r"\b(accident|emergency|danger|crisis)\b"
]

# Simple list of emotion words (both positive and negative)
EMOTION_KEYWORDS = [
    r"\b(happy|glad|excited|thrilled|joy|delighted|pleased)\b",
    r"\b(sad|unhappy|depressed|grief|sorrow|crying|mourn)\b",
    r"\b(angry|mad|furious|irritated|annoyed|rage|hate)\b",
    r"\b(scared|afraid|fear|terrified|anxious|nervous|worried)\b",
    r"\b(surprised|shocked|amazed|astonished|astounded)\b",
    r"\b(love|adore|care|affection|warmth|passion)\b",
    r"\b(ashamed|guilty|regret|sorry|embarrassed)\b"
]

def tokenize(text: str) -> List[str]:
    """Tokenize and lowercase alphanumeric terms."""
    return re.findall(r"\w+", text.lower())

def calculate_tf(tokens: List[str]) -> dict:
    """Calculate term frequencies."""
    tf = {}
    for t in tokens:
        tf[t] = tf.get(t, 0) + 1
    return tf

def compute_cosine_similarity(tf1: dict, tf2: dict) -> float:
    """Compute cosine similarity between two term frequency dictionaries."""
    intersection = set(tf1.keys()) & set(tf2.keys())
    if not intersection:
        return 0.0
    
    numerator = sum(tf1[x] * tf2[x] for x in intersection)
    
    sum1 = sum(val ** 2 for val in tf1.values())
    sum2 = sum(val ** 2 for val in tf2.values())
    
    denominator = math.sqrt(sum1) * math.sqrt(sum2)
    if not denominator:
        return 0.0
    return numerator / denominator

def score_importance(text: str) -> float:
    """Score importance based on rule matching (0.0 to 1.0)."""
    text_lower = text.lower()
    matches = 0
    for kw in IMPORTANCE_KEYWORDS:
        if re.search(kw, text_lower):
            matches += 1
            
    # Base importance is 0.3, increments per match up to 1.0
    score = 0.3 + (matches * 0.15)
    return min(score, 1.0)

def score_emotion(text: str) -> float:
    """Score emotional charge based on rule matching (0.0 to 1.0)."""
    text_lower = text.lower()
    matches = 0
    for kw in EMOTION_KEYWORDS:
        if re.search(kw, text_lower):
            matches += 1
            
    # Bumps for exclamation marks or capital words
    if "!" in text:
        matches += 1
    
    # Base emotion is 0.2, increments per match up to 1.0
    score = 0.2 + (matches * 0.15)
    return min(score, 1.0)

def score_novelty(text: str, db: Session) -> float:
    """Score novelty against existing database episodic memories (0.0 to 1.0)."""
    # Fetch recent non-forgotten memories
    existing_memories = db.query(EpisodicMemory).filter(EpisodicMemory.is_forgotten == False).all()
    if not existing_memories:
        return 1.0 # If no prior memories, everything is completely novel
        
    new_tokens = tokenize(text)
    if not new_tokens:
        return 0.0
        
    new_tf = calculate_tf(new_tokens)
    
    max_sim = 0.0
    for mem in existing_memories:
        mem_tokens = tokenize(mem.raw_text)
        mem_tf = calculate_tf(mem_tokens)
        sim = compute_cosine_similarity(new_tf, mem_tf)
        if sim > max_sim:
            max_sim = sim
            
    # Novelty is inverse of maximum similarity (1.0 = completely different, 0.0 = exact match)
    return 1.0 - max_sim

def calculate_salience(text: str, db: Session) -> dict:
    """
    Calculate composite salience score and return breakdowns.
    Salience = 0.3 * Novelty + 0.4 * Importance + 0.3 * Emotion
    """
    importance = score_importance(text)
    emotion = score_emotion(text)
    novelty = score_novelty(text, db)
    
    composite = (0.3 * novelty) + (0.4 * importance) + (0.3 * emotion)
    
    return {
        "salience": round(composite, 3),
        "importance": round(importance, 3),
        "emotion": round(emotion, 3),
        "novelty": round(novelty, 3)
    }
