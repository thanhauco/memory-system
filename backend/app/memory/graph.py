import re
from typing import List, Tuple
from sqlalchemy.orm import Session
from ..models import SemanticEntity, SemanticRelation, EpisodicMemory

# Heuristics for classifications
PLACE_PREPOSITIONS = ["at", "in", "to", "inside", "near", "through", "visit", "visited"]
INTERACTION_VERBS = ["met", "talked", "spoke", "called", "emailed", "helped", "colleague", "friend"]
CONCEPT_WORDS = ["computing", "learning", "ai", "project", "code", "theory", "science", "math", "design", "development"]

def extract_entities_and_relations(text: str) -> Tuple[List[dict], List[dict]]:
    """
    Heuristically extracts entities and relationships from raw text.
    Returns:
      entities: list of dicts, e.g. [{"name": "Alice", "type": "Person"}]
      relations: list of dicts, e.g. [{"source": "Alice", "relation": "met", "target": "Bob"}]
    """
    entities_found = {}
    relations_found = []
    
    # 1. Regex to find capitalized words (representing potential proper nouns: names, places, etc.)
    # We filter out sentence starts unless they appear capitalized elsewhere or match specific entity tags
    candidates = re.findall(r'\b[A-Z][a-zA-Z0-9_-]*(?:\s+[A-Z][a-zA-Z0-9_-]*)*\b', text)
    
    # Remove duplicates and clean
    candidates = list(set([c.strip() for c in candidates if len(c) > 1]))
    
    # Simple list of words that are capitalized but are usually just words
    stopwords = {"I", "The", "He", "She", "They", "We", "It", "My", "This", "That", "Today", "Yesterday", "Tomorrow", "A", "An", "In", "On", "At"}
    entity_names = [c for c in candidates if c not in stopwords]
    
    # Assign entity types heuristically
    text_lower = text.lower()
    for name in entity_names:
        name_lower = name.lower()
        ent_type = "Concept"
        
        # Check context in text
        # If preceded by person verbs
        preceded_by = re.findall(rf'(\w+)\s+{re.escape(name_lower)}', text_lower)
        followed_by = re.findall(rf'{re.escape(name_lower)}\s+(\w+)', text_lower)
        
        context_words = preceded_by + followed_by
        
        is_place = any(w in PLACE_PREPOSITIONS for w in context_words) or "office" in name_lower or "cafe" in name_lower or "street" in name_lower or "shop" in name_lower
        is_person = any(w in INTERACTION_VERBS for w in context_words) or name in ["Alice", "Bob", "Charlie", "David", "Eve", "John", "Sarah", "Alex"]
        is_concept = any(w in CONCEPT_WORDS for w in name_lower.split())
        
        if is_place:
            ent_type = "Place"
        elif is_person:
            ent_type = "Person"
        elif is_concept:
            ent_type = "Concept"
        else:
            # Default fallback based on capitalization shape
            if len(name.split()) > 1:
                ent_type = "Concept"
            else:
                ent_type = "Person"
                
        entities_found[name] = {
            "name": name,
            "type": ent_type,
            "description": f"Extracted entity representing {name} ({ent_type})."
        }
        
    # Add common lower-case concepts that are highly relevant to technical/academic contexts
    common_concepts = ["quantum computing", "machine learning", "neural networks", "databases", "programming", "artificial intelligence"]
    for concept in common_concepts:
        if concept in text_lower:
            title_concept = concept.title()
            if title_concept not in entities_found:
                entities_found[title_concept] = {
                    "name": title_concept,
                    "type": "Concept",
                    "description": f"Extracted core concept: {title_concept}"
                }
                entity_names.append(title_concept)
                
    # 2. Extract Relationships
    # If we have 2 or more entities, find relations between them based on word distance and verbs
    sorted_entities = sorted(list(entities_found.keys()), key=lambda x: text.find(x))
    
    for i in range(len(sorted_entities)):
        for j in range(i + 1, len(sorted_entities)):
            ent1 = sorted_entities[i]
            ent2 = sorted_entities[j]
            
            # Find the text span between them
            pos1 = text.find(ent1) + len(ent1)
            pos2 = text.find(ent2)
            
            span = text[pos1:pos2].strip()
            
            # If they are relatively close (within 80 chars), extract a relationship
            if 0 < len(span) < 80:
                span_lower = span.lower()
                rel_type = "associated_with"
                
                # Check for specific relationship verbal linkages
                if any(v in span_lower for v in ["met at", "went to", "visited", "located at", "inside"]):
                    rel_type = "located_at" if entities_found[ent2]["type"] == "Place" else "associated_with"
                elif any(v in span_lower for v in ["discussed", "talked about", "argued about", "works on", "coding"]):
                    rel_type = "works_on" if entities_found[ent2]["type"] == "Concept" else "collaborates_with"
                elif any(v in span_lower for v in ["met", "spoke to", "called", "emailed", "worked with"]):
                    rel_type = "interacts_with"
                    
                relations_found.append({
                    "source": ent1,
                    "relation_type": rel_type,
                    "target": ent2
                })
                
    return list(entities_found.values()), relations_found

def update_graph_memory(db: Session, memory: EpisodicMemory) -> list:
    """
    Extracts semantic elements from a new memory, writes them to the DB,
    strengthens relationships, and links them to the episode.
    """
    entities, relations = extract_entities_and_relations(memory.raw_text)
    
    db_entities = []
    
    # 1. Upsert Entities
    for ent_data in entities:
        existing_ent = db.query(SemanticEntity).filter(SemanticEntity.name == ent_data["name"]).first()
        if existing_ent:
            # Boost activity score when entity is re-encountered
            existing_ent.activity_score = min(existing_ent.activity_score + 0.3, 1.0)
            db_ent = existing_ent
        else:
            db_ent = SemanticEntity(
                name=ent_data["name"],
                type=ent_data["type"],
                description=ent_data["description"],
                activity_score=1.0
            )
            db.add(db_ent)
            db.flush() # Populate ID
            
        db_entities.append(db_ent)
        
        # Link memory <-> entity (prevent duplicates)
        if db_ent not in memory.entities:
            memory.entities.append(db_ent)
            
    # 2. Upsert Relations
    for rel_data in relations:
        src_name = rel_data["source"]
        tgt_name = rel_data["target"]
        
        src_ent = next((e for e in db_entities if e.name == src_name), None)
        tgt_ent = next((e for e in db_entities if e.name == tgt_name), None)
        
        if not src_ent or not tgt_ent:
            # Try to fetch from database if not in current batch
            if not src_ent:
                src_ent = db.query(SemanticEntity).filter(SemanticEntity.name == src_name).first()
            if not tgt_ent:
                tgt_ent = db.query(SemanticEntity).filter(SemanticEntity.name == tgt_name).first()
                
        if src_ent and tgt_ent:
            # Check if relation already exists (either direction, but match source/target)
            existing_rel = db.query(SemanticRelation).filter(
                SemanticRelation.source_id == src_ent.id,
                SemanticRelation.target_id == tgt_ent.id,
                SemanticRelation.relation_type == rel_data["relation_type"]
            ).first()
            
            if existing_rel:
                # Strengthen existing relationship
                existing_rel.strength = min(existing_rel.strength + 0.5, 5.0)
            else:
                db_rel = SemanticRelation(
                    source_id=src_ent.id,
                    target_id=tgt_ent.id,
                    relation_type=rel_data["relation_type"],
                    strength=1.0
                )
                db.add(db_rel)
                
    db.commit()
    return [ent.name for ent in db_entities]
