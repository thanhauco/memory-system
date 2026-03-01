import math
from datetime import datetime
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from ..models import EpisodicMemory, AbstractionNode, SemanticRelation, SemanticEntity
from .salience import tokenize, calculate_tf, compute_cosine_similarity

def calculate_recency_score(timestamp: datetime, oldest_time: datetime, newest_time: datetime) -> float:
    """Calculates recency score between 0.0 and 1.0 using min-max normalization."""
    if newest_time == oldest_time:
        return 1.0
    total_range = (newest_time - oldest_time).total_seconds()
    if total_range == 0:
        return 1.0
    return (timestamp - oldest_time).total_seconds() / total_range

def retrieve_memories(
    db: Session, 
    query: str, 
    alpha: float = 0.5, 
    beta: float = 0.25, 
    gamma: float = 0.25,
    limit: int = 5
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Performs a hybrid search over Episodic memories, Abstractions, and Graph triplets.
    Score = alpha * Similarity + beta * Recency + gamma * Salience
    """
    query_tokens = tokenize(query)
    query_tf = calculate_tf(query_tokens) if query_tokens else {}
    
    # 1. Fetch active episodic memories (non-forgotten, and usually we focus on uncompressed ones for details)
    episodes = db.query(EpisodicMemory).filter(
        EpisodicMemory.is_forgotten == False
    ).all()
    
    # 2. Fetch abstractions
    abstractions = db.query(AbstractionNode).all()
    
    # Prepare timestamps for recency min-max normalization
    all_timestamps = [e.timestamp for e in episodes] + [a.created_at for a in abstractions]
    oldest_time = min(all_timestamps) if all_timestamps else datetime.utcnow()
    newest_time = max(all_timestamps) if all_timestamps else datetime.utcnow()
    
    # --- Score Episodic Memories ---
    episode_results = []
    for ep in episodes:
        # Cosine similarity
        ep_tokens = tokenize(ep.raw_text)
        ep_tf = calculate_tf(ep_tokens) if ep_tokens else {}
        similarity = compute_cosine_similarity(query_tf, ep_tf) if query_tf else 0.0
        
        # Recency score
        recency = calculate_recency_score(ep.timestamp, oldest_time, newest_time)
        
        # Salience
        salience = ep.current_salience
        
        # Composite score
        score = (alpha * similarity) + (beta * recency) + (gamma * salience)
        
        episode_results.append({
            "type": "episodic",
            "memory": ep.to_dict(),
            "score": round(score, 3),
            "breakdown": {
                "similarity": round(similarity, 3),
                "recency": round(recency, 3),
                "salience": round(salience, 3)
            }
        })
        
    # Sort episodes by score descending
    episode_results.sort(key=lambda x: x["score"], reverse=True)
    
    # --- Score Abstractions ---
    abstraction_results = []
    for ab in abstractions:
        # Similarity against summary and concept tags
        ab_text = ab.summary + " " + " ".join(ab.concept_tags)
        ab_tokens = tokenize(ab_text)
        ab_tf = calculate_tf(ab_tokens) if ab_tokens else {}
        similarity = compute_cosine_similarity(query_tf, ab_tf) if query_tf else 0.0
        
        # Recency score
        recency = calculate_recency_score(ab.created_at, oldest_time, newest_time)
        
        # Salience
        salience = ab.salience_score
        
        # Composite score
        score = (alpha * similarity) + (beta * recency) + (gamma * salience)
        
        abstraction_results.append({
            "type": "abstraction",
            "memory": ab.to_dict(),
            "score": round(score, 3),
            "breakdown": {
                "similarity": round(similarity, 3),
                "recency": round(recency, 3),
                "salience": round(salience, 3)
            }
        })
        
    # Sort abstractions by score descending
    abstraction_results.sort(key=lambda x: x["score"], reverse=True)
    
    # --- Spaced Repetition Reinforcement ---
    # Top candidates actually selected for prompt context are reinforced in database
    top_episodes = episode_results[:limit]
    for item in top_episodes:
        db_ep = db.query(EpisodicMemory).filter(EpisodicMemory.id == item["memory"]["id"]).first()
        if db_ep:
            db_ep.retrieval_count = (db_ep.retrieval_count or 0) + 1
            # Active recall reinforcement: boost salience by +0.05
            db_ep.current_salience = min(round(db_ep.current_salience + 0.05, 3), 1.0)
            # Refresh serialized object to display updated counts/scores in UI
            item["memory"] = db_ep.to_dict()
            
    top_abstractions = abstraction_results[:limit]
    for item in top_abstractions:
        db_ab = db.query(AbstractionNode).filter(AbstractionNode.id == item["memory"]["id"]).first()
        if db_ab:
            db_ab.retrieval_count = (db_ab.retrieval_count or 0) + 1
            db_ab.salience_score = min(round(db_ab.salience_score + 0.05, 3), 1.0)
            item["memory"] = db_ab.to_dict()
            
    if top_episodes or top_abstractions:
        db.commit()
        
    # --- Retrieve Knowledge Graph Triplets ---
    # Find triplets where source or target name matches query terms
    triplet_results = []
    if query_tokens:
        # Search for relations matching entities
        relations = db.query(SemanticRelation).all()
        for rel in relations:
            src_name = rel.source.name.lower() if rel.source else ""
            tgt_name = rel.target.name.lower() if rel.target else ""
            
            # Match if any token is a substring of the source or target entity name
            match = False
            for tok in query_tokens:
                if tok in src_name or tok in tgt_name:
                    match = True
                    break
                    
            if match:
                triplet_results.append(rel.to_dict())
                
    return {
        "episodes": top_episodes,
        "abstractions": top_abstractions,
        "triplets": triplet_results[:limit*2]
    }
