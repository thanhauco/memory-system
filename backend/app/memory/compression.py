from typing import List
from sqlalchemy.orm import Session
from ..models import EpisodicMemory, AbstractionNode, SemanticEntity

def compress_memories(db: Session, min_cluster_size: int = 2) -> list:
    """
    Identifies uncompressed episodic memories, clusters them by shared entities,
    synthesizes an abstraction node, and archives (compresses) the raw episodes.
    """
    # 1. Fetch all uncompressed, non-forgotten memories
    uncompressed = db.query(EpisodicMemory).filter(
        EpisodicMemory.is_compressed == False,
        EpisodicMemory.is_forgotten == False
    ).order_by(EpisodicMemory.timestamp.asc()).all()
    
    if len(uncompressed) < min_cluster_size:
        return [] # Not enough memories to compress
        
    # 2. Cluster memories based on shared entities
    clusters = []
    visited_ids = set()
    
    for i, mem in enumerate(uncompressed):
        if mem.id in visited_ids:
            continue
            
        # Start a new cluster
        cluster = [mem]
        visited_ids.add(mem.id)
        
        # Find others that share at least one entity with this memory
        mem_entities = set(e.id for e in mem.entities)
        
        for other_mem in uncompressed[i+1:]:
            if other_mem.id in visited_ids:
                continue
                
            other_entities = set(e.id for e in other_mem.entities)
            if mem_entities & other_entities:
                cluster.append(other_mem)
                visited_ids.add(other_mem.id)
                
        if len(cluster) >= min_cluster_size:
            clusters.append(cluster)
            
    # Handle leftover memories: if there are any remaining uncompressed memories,
    # group them together if we have enough, or just let them stay uncompressed for now.
    leftovers = [m for m in uncompressed if m.id not in visited_ids]
    if len(leftovers) >= min_cluster_size:
        clusters.append(leftovers)
        
    created_abstractions = []
    
    # 3. Process clusters and build abstractions
    for cluster in clusters:
        # Collect all entities across the cluster
        entities_in_cluster = {}
        for m in cluster:
            for ent in m.entities:
                entities_in_cluster[ent.name] = ent
                
        # Generate summary synthesis (rule-based out-of-the-box abstraction)
        entity_names_str = ", ".join(list(entities_in_cluster.keys()))
        if not entity_names_str:
            entity_names_str = "general concepts"
            
        summary_lines = []
        for m in cluster:
            # Simple sentence summarizer: clean up raw text
            text_cleaned = m.raw_text.strip()
            if not text_cleaned.endswith((".", "!", "?")):
                text_cleaned += "."
            summary_lines.append(f"- {text_cleaned} (Salience: {m.current_salience})")
            
        composite_summary = (
            f"Consolidated abstraction of experiences concerning {entity_names_str}:\n"
            + "\n".join(summary_lines)
        )
        
        # Calculate composite salience score for the abstraction (e.g. average of children)
        avg_salience = sum(m.current_salience for m in cluster) / len(cluster)
        avg_salience = round(avg_salience, 3)
        
        # Create AbstractionNode
        abs_node = AbstractionNode(
            summary=composite_summary,
            concept_tags=list(entities_in_cluster.keys()),
            level=1,
            salience_score=avg_salience
        )
        db.add(abs_node)
        db.flush() # Populate ID
        
        # Update episodic memories in cluster
        for m in cluster:
            m.is_compressed = True
            m.parent_abstraction_id = abs_node.id
            
        created_abstractions.append(abs_node.to_dict())
        
    db.commit()
    return created_abstractions
