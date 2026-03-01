from typing import Dict, Any, List
from sqlalchemy.orm import Session
from .retrieval import retrieve_memories

def count_words(text: str) -> int:
    """Helper to estimate token/word count of a text block."""
    return len(text.split())

def assemble_context(
    db: Session,
    query: str,
    word_budget: int = 400,
    triplet_weight: float = 0.20,
    abstraction_weight: float = 0.40,
    episodic_weight: float = 0.40
) -> Dict[str, Any]:
    """
    Assembles a prompt-ready context by adaptively packing information from
    knowledge graph triplets, abstractions, and episodic memories based on a word budget.
    """
    # 1. Retrieve candidates
    # We pull a generous number of candidates so we have options to pack
    retrieved = retrieve_memories(db, query, limit=15)
    
    episodes = retrieved["episodes"]
    abstractions = retrieved["abstractions"]
    triplets = retrieved["triplets"]
    
    # 2. Determine target budgets in words
    target_triplet_budget = int(word_budget * triplet_weight)
    target_abstraction_budget = int(word_budget * abstraction_weight)
    target_episodic_budget = int(word_budget * episodic_weight)
    
    # Containers for compiled text chunks
    packed_triplets: List[str] = []
    packed_abstractions: List[str] = []
    packed_episodes: List[str] = []
    
    # Track word usage per category
    used_triplet_words = 0
    used_abstraction_words = 0
    used_episodic_words = 0
    
    # 3. Pack Triplets (High priority, high density)
    triplet_intro = "[Semantic Knowledge Graph Connections]"
    packed_triplets.append(triplet_intro)
    used_triplet_words += count_words(triplet_intro)
    
    triplets_added = 0
    for trip in triplets:
        trip_str = f"- ({trip['source_name']}) --[{trip['relation_type']}]--> ({trip['target_name']}) [strength: {trip['strength']}]"
        trip_words = count_words(trip_str)
        
        # Check if it fits in target triplet budget
        if used_triplet_words + trip_words <= target_triplet_budget:
            packed_triplets.append(trip_str)
            used_triplet_words += trip_words
            triplets_added += 1
        else:
            break
            
    if triplets_added == 0:
        packed_triplets = [] # Remove section if empty
        used_triplet_words = 0
        
    # 4. Pack Abstractions (High coverage)
    abs_intro = "[Synthesized Conceptual Abstractions]"
    packed_abstractions.append(abs_intro)
    used_abstraction_words += count_words(abs_intro)
    
    abs_added = 0
    for item in abstractions:
        abs_node = item["memory"]
        abs_str = f"Concept: {', '.join(abs_node['concept_tags'])}\n{abs_node['summary']}"
        abs_words = count_words(abs_str)
        
        if used_abstraction_words + abs_words <= target_abstraction_budget:
            packed_abstractions.append(abs_str)
            used_abstraction_words += abs_words
            abs_added += 1
        else:
            break
            
    if abs_added == 0:
        packed_abstractions = []
        used_abstraction_words = 0
        
    # 5. Pack Detailed Episodic Memories
    ep_intro = "[Detailed Episodic Logs (Chronological / Relevant)]"
    packed_episodes.append(ep_intro)
    used_episodic_words += count_words(ep_intro)
    
    ep_added = 0
    for item in episodes:
        ep_node = item["memory"]
        # Skip compressed episodes to avoid redundant detail if we already show abstractions
        if ep_node["is_compressed"]:
            continue
            
        ep_str = f"[{ep_node['timestamp'][:10]}] Experience: {ep_node['raw_text']} (Salience: {ep_node['current_salience']})"
        ep_words = count_words(ep_str)
        
        if used_episodic_words + ep_words <= target_episodic_budget:
            packed_episodes.append(ep_str)
            used_episodic_words += ep_words
            ep_added += 1
        else:
            break
            
    if ep_added == 0:
        packed_episodes = []
        used_episodic_words = 0
        
    # --- Adaptive Redistribution ---
    # If any category didn't use its budget, we allocate the surplus to the other lists.
    total_used_words = used_triplet_words + used_abstraction_words + used_episodic_words
    surplus_words = word_budget - total_used_words
    
    # Try to pack remaining items using the surplus budget
    if surplus_words > 10:
        # Try to pack more episodes
        for item in episodes:
            ep_node = item["memory"]
            # Check if already added
            ep_str = f"[{ep_node['timestamp'][:10]}] Experience: {ep_node['raw_text']} (Salience: {ep_node['current_salience']})"
            if ep_str in packed_episodes or ep_node["is_compressed"]:
                continue
                
            ep_words = count_words(ep_str)
            if ep_words <= surplus_words:
                if not packed_episodes:
                    packed_episodes.append(ep_intro)
                    used_episodic_words += count_words(ep_intro)
                    surplus_words -= count_words(ep_intro)
                    
                packed_episodes.append(ep_str)
                used_episodic_words += ep_words
                surplus_words -= ep_words
            else:
                break
                
        # Try to pack more abstractions if surplus remains
        if surplus_words > 10:
            for item in abstractions:
                abs_node = item["memory"]
                abs_str = f"Concept: {', '.join(abs_node['concept_tags'])}\n{abs_node['summary']}"
                if abs_str in packed_abstractions:
                    continue
                    
                abs_words = count_words(abs_str)
                if abs_words <= surplus_words:
                    if not packed_abstractions:
                        packed_abstractions.append(abs_intro)
                        used_abstraction_words += count_words(abs_intro)
                        surplus_words -= count_words(abs_intro)
                        
                    packed_abstractions.append(abs_str)
                    used_abstraction_words += abs_words
                    surplus_words -= abs_words
                else:
                    break
                    
    # 6. Assemble the final context string
    final_sections = []
    if packed_triplets:
        final_sections.append("\n".join(packed_triplets))
    if packed_abstractions:
        final_sections.append("\n".join(packed_abstractions))
    if packed_episodes:
        final_sections.append("\n".join(packed_episodes))
        
    assembled_context = "\n\n".join(final_sections)
    total_used_words = used_triplet_words + used_abstraction_words + used_episodic_words
    
    return {
        "query": query,
        "assembled_context": assembled_context,
        "word_budget": word_budget,
        "total_used_words": total_used_words,
        "allocation_stats": {
            "triplets": {
                "budget": target_triplet_budget,
                "used": used_triplet_words,
                "count": triplets_added
            },
            "abstractions": {
                "budget": target_abstraction_budget,
                "used": used_abstraction_words,
                "count": abs_added
            },
            "episodes": {
                "budget": target_episodic_budget,
                "used": used_episodic_words,
                "count": ep_added
            },
            "surplus_redistributed": surplus_words
        }
    }
