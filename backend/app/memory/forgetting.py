import math
from sqlalchemy.orm import Session
from ..models import EpisodicMemory, SemanticEntity, SemanticRelation

def decay_memories(db: Session, base_decay_rate: float = 0.05, forget_threshold: float = 0.15, policy: str = "spaced_repetition") -> dict:
    """
    Decays the salience of episodic memories, entity activity scores, and relationship strengths.
    Prunes elements that fall below the forgetting thresholds. Supports multiple policies:
    'linear', 'exponential', and 'spaced_repetition'.
    """
    # 1. Decay Episodic Memories
    active_memories = db.query(EpisodicMemory).filter(
        EpisodicMemory.is_forgotten == False,
        EpisodicMemory.is_compressed == False
    ).all()
    
    decayed_count = 0
    forgotten_count = 0
    
    for mem in active_memories:
        # Compute the decay rate lambda modulated by importance
        lambda_base = base_decay_rate * (1.0 - mem.importance)
        
        # Calculate new salience based on chosen policy
        if policy == "spaced_repetition":
            # Spaced repetition divides the decay rate by (1 + retrieval_count)
            # This makes recalled memories highly stable.
            lambda_val = lambda_base / (1.0 + (mem.retrieval_count or 0))
            new_salience = mem.current_salience * math.exp(-lambda_val)
        elif policy == "linear":
            # Linear decay decreases by a fixed step, ignoring spacing
            step = lambda_base
            new_salience = mem.current_salience - step
        else: # "exponential" policy
            # Standard exponential decay, ignoring spacing
            new_salience = mem.current_salience * math.exp(-lambda_base)
            
        mem.current_salience = max(round(new_salience, 3), 0.0)
        decayed_count += 1
        
        # Check if memory falls below forgetting threshold
        if mem.current_salience < forget_threshold:
            # Check if this memory is connected to any highly active semantic entities (score > 0.7)
            # This simulates "associative recall" preventing memory decay
            has_active_association = any(ent.activity_score > 0.7 for ent in mem.entities)
            
            if not has_active_association:
                mem.is_forgotten = True
                forgotten_count += 1
                
    # 2. Decay Semantic Entities (activity_score)
    # Entities decay slower, e.g., 5% decay per step
    entities = db.query(SemanticEntity).all()
    for ent in entities:
        ent.activity_score = max(round(ent.activity_score * 0.95, 3), 0.0)
        
    # 3. Decay Semantic Relations (strength)
    # Relations decay, e.g., 3% decay per step
    relations = db.query(SemanticRelation).all()
    relations_deleted = 0
    for rel in relations:
        rel.strength = max(round(rel.strength * 0.97, 3), 0.0)
        
        # Prune relations that become extremely weak (strength < 0.1)
        if rel.strength < 0.1:
            db.delete(rel)
            relations_deleted += 1
            
    db.commit()
    
    return {
        "decayed_episodes": decayed_count,
        "forgotten_episodes": forgotten_count,
        "relations_pruned": relations_deleted
    }
