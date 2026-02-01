# Technical Architecture: Intelligent Memory System (IMS)

This document provides a detailed breakdown of the cognitive mechanics and data representations implemented in the Intelligent Memory System.

---

## 1. Data Representation (Database Schema)

The core storage is managed via SQLite using SQLAlchemy. There are three primary types of memory entities:

### 1.1 Episodic Memory
Represents the stream of raw experiences.
*   **Fields**: `id`, `raw_text`, `timestamp`, `initial_salience`, `current_salience`, `importance`, `novelty`, `emotion`, `is_compressed`, `is_forgotten`, `parent_abstraction_id`.
*   **Indexing**: Primary indexing is on `timestamp` and `current_salience` for quick retrieval and forgetting checks.

### 1.2 Semantic Graph Memory
Represents the structured knowledge extracted from episodes.
*   **SemanticEntity**: Vertices representing distinct agents, concepts, or physical locations.
    *   *Fields*: `id`, `name`, `type`, `description`, `activity_score`.
*   **SemanticRelation**: Directed edges indicating semantic relationships.
    *   *Fields*: `id`, `source_id`, `target_id`, `relation_type`, `strength` (weight).
*   **MemoryRelation**: A many-to-many join table mapping which `EpisodicMemory` referenced which `SemanticEntity`.

### 1.3 Abstraction Nodes
Represents condensed hierarchical representations of compressed episodic memories.
*   **Fields**: `id`, `summary`, `concept_tags` (JSON), `level` (depth), `created_at`, `salience_score`.

---

## 2. Core Cognitive Mechanics

```
                  ┌───────────────────────┐
                  │   Incoming Episode    │
                  └──────────┬────────────┘
                             ▼
                ┌───────────────────────────┐
                │   Salience Scoring API    │
                │                           │
                │  - Importance Check (NLP) │
                │  - Emotion Valence        │
                │  - Novelty vs. Database   │
                └────────────┬──────────────┘
                             ▼
             ┌───────────────────────────────┐
             │       Database Ingestion      │
             │                               │
             │  - Write Episodic Record      │
             │  - Extract Entity/Relation    │
             │  - Update Semantic Graph      │
             └──────────────┬────────────────┘
                            ▼
             ┌───────────────────────────────┐
             │     Background Tick Jobs      │
             │                               │
             │  - Decay Memory Salience      │
             │  - Prune/Archive Decayed      │
             │  - Cluster & Abstract Old     │
             └───────────────────────────────┘
```

### 2.1 Salience Scoring
The salience $S_{comp}$ of a new memory $M$ is a composite of three features:
$$S_{comp} = w_n \cdot Novelty + w_i \cdot Importance + w_e \cdot Emotion$$
*   **Weights**: $w_n = 0.3$, $w_i = 0.4$, $w_e = 0.3$.
*   **Novelty**: Computed as:
    $$Novelty(M) = 1.0 - \max_{E \in DB} \left( \text{CosineSimilarity}(M, E) \right)$$
    where cosine similarity is calculated over Term Frequency vectors.
*   **Importance**: Regex-based matching of goals, decisions, milestones, and crisis triggers.
*   **Emotion**: Sentiment word intensity + formatting checks (exclamation marks, ALL CAPS words).

### 2.2 Forgetting (Decay & Pruning)
Memories undergo exponential decay over simulated "time ticks" $t$:
$$S_{current}(t) = S_{initial} \cdot e^{-\lambda t}$$
*   The decay rate $\lambda$ is dynamically adjusted by the memory's `importance`:
    $$\lambda = \lambda_{base} \cdot (1.0 - Importance)$$
    This ensures highly important memories (e.g. key life events) decay much slower.
*   **Pruning**: During a decay tick, if $S_{current}(t) < \theta_{forget}$ (default 0.15), the memory state is updated to `is_forgotten = True`, hiding it from standard queries unless specifically retrieved from archive.

### 2.3 Entity & Relation Graph Extraction
When a memory is ingested, it is parsed for entities and relationships:
1.  **Entity Recognition**: Custom dictionary and capitalized-word phrase parser extracts potential entities.
2.  **Relation Extraction**: Detects transition keywords (e.g. "met", "at", "works on", "located in") to form $(Entity_1 \rightarrow Relation \rightarrow Entity_2)$ triplets.
3.  **Graph Update**: If the entity/relation already exists, its `activity_score` or `strength` is incremented. Otherwise, a new record is created in the database.

### 2.4 Compression & Abstraction
To keep agent memory scalable, a compression routine runs:
1.  **Clustering**: Groups episodic memories older than a duration threshold that share entities or TF-IDF tokens.
2.  **Abstraction Generation**: Merges clustered episodes. (Out-of-the-box, it creates a bulleted list of facts/timeline synthesis. If LLMs are configured, it invokes the LLM to write a coherent summary).
3.  **Archiving**: Links the episodes to the new `AbstractionNode` and flags them `is_compressed = True` to exclude them from standard detailed timelines.

### 2.5 Hybrid Retrieval
Retrieval uses a score composite based on a query $Q$ and a memory node $M$:
$$\text{Score}(M, Q) = \alpha \cdot \text{Similarity}(M, Q) + \beta \cdot \text{Recency}(M) + \gamma \cdot \text{Salience}(M)$$
*   **Similarity**: Character/word overlap cosine similarity.
*   **Recency**: Normalized time difference.
*   **Salience**: Current decayed salience.

### 2.6 Adaptive Context Assembly
When assembling context for an LLM:
1.  Retrieves top candidate Abstractions, Semantic triplets, and Episodic memories.
2.  Allocates the token budget (e.g., maximum word length) using a priority queue:
    *   **Tier 1**: Semantic Graph triplets (high context density).
    *   **Tier 2**: Relevant Abstraction Nodes (broad coverage).
    *   **Tier 3**: High-salience Recent Episodic memories.
    *   **Tier 4**: Specific raw query-similar Episodic memories.
3.  Appends nodes to the context until the token budget is reached.
