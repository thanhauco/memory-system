from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from typing import Optional, List

from .database import get_db, init_db
from .models import EpisodicMemory, SemanticEntity, SemanticRelation, AbstractionNode, Base, memory_entity_association
from .database import engine
from .memory.salience import calculate_salience
from .memory.graph import update_graph_memory
from .memory.forgetting import decay_memories
from .memory.compression import compress_memories
from .memory.context_assembly import assemble_context

app = FastAPI(title="Intelligent Memory System (IMS) API")

# Configure CORS so the frontend can communicate with the backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Startup DB initialization
@app.on_event("startup")
def on_startup():
    init_db()

# Pydantic Schemas
class ExperienceInput(BaseModel):
    text: str = Field(..., min_length=1, description="Raw text of the experience")

class ContextRequest(BaseModel):
    query: str = Field(..., description="Query for context retrieval")
    word_budget: Optional[int] = Field(400, ge=50, le=2000)
    triplet_weight: Optional[float] = Field(0.20, ge=0.0, le=1.0)
    abstraction_weight: Optional[float] = Field(0.40, ge=0.0, le=1.0)
    episodic_weight: Optional[float] = Field(0.40, ge=0.0, le=1.0)

# Endpoints
@app.post("/memories", response_model=dict)
def add_memory(payload: ExperienceInput, db: Session = Depends(get_db)):
    """
    Ingests a new episodic experience:
    1. Computes multi-dimensional salience scoring.
    2. Writes the episode to database.
    3. Triggers entity and relationship extraction.
    4. Connects graph entities to the episode.
    """
    try:
        # Calculate salience
        salience_data = calculate_salience(payload.text, db)
        
        # Create episodic memory entry
        memory = EpisodicMemory(
            raw_text=payload.text,
            initial_salience=salience_data["salience"],
            current_salience=salience_data["salience"],
            importance=salience_data["importance"],
            novelty=salience_data["novelty"],
            emotion=salience_data["emotion"],
            is_compressed=False,
            is_forgotten=False,
            retrieval_count=0
        )
        db.add(memory)
        db.flush() # Populate memory ID
        
        # Process graph additions and links
        extracted_entities = update_graph_memory(db, memory)
        
        return {
            "status": "success",
            "memory": memory.to_dict(),
            "salience_breakdown": salience_data,
            "extracted_entities": extracted_entities
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/memories/decay", response_model=dict)
def trigger_decay(policy: str = "spaced_repetition", db: Session = Depends(get_db)):
    """
    Simulates a cognitive time step. Decays salience scores of episodes
    and relation weights in the knowledge graph. Prunes/forgets weak nodes.
    Supports 'linear', 'exponential', and 'spaced_repetition' policies.
    """
    try:
        stats = decay_memories(db, policy=policy)
        return {
            "status": "success",
            "decay_stats": stats
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/memories/compress", response_model=dict)
def trigger_compression(db: Session = Depends(get_db)):
    """
    Triggers memory clustering and abstraction consolidation.
    Groups old episodic memories and creates high-level Abstraction nodes.
    """
    try:
        abstractions = compress_memories(db)
        return {
            "status": "success",
            "abstractions_created_count": len(abstractions),
            "abstractions": abstractions
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/context/assemble", response_model=dict)
def trigger_context_assembly(payload: ContextRequest, db: Session = Depends(get_db)):
    """
    Assembles a prompt-ready context block by adaptively packing information
    under a strict token/word budget.
    """
    try:
        # Normalize weights to sum to 1.0
        total_w = payload.triplet_weight + payload.abstraction_weight + payload.episodic_weight
        w_trip = payload.triplet_weight / total_w
        w_abs = payload.abstraction_weight / total_w
        w_ep = payload.episodic_weight / total_w
        
        assembly_result = assemble_context(
            db=db,
            query=payload.query,
            word_budget=payload.word_budget,
            triplet_weight=w_trip,
            abstraction_weight=w_abs,
            episodic_weight=w_ep
        )
        return {
            "status": "success",
            "data": assembly_result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/memories/state", response_model=dict)
def get_memory_state(db: Session = Depends(get_db)):
    """
    Returns the complete structured state of the memory system for dashboard visualizer.
    """
    try:
        # Episodes (excluding forgotten)
        episodes = db.query(EpisodicMemory).filter(EpisodicMemory.is_forgotten == False).all()
        # Forgotten / archived
        forgotten = db.query(EpisodicMemory).filter(EpisodicMemory.is_forgotten == True).all()
        # Abstractions
        abstractions = db.query(AbstractionNode).all()
        # Entities
        entities = db.query(SemanticEntity).all()
        # Relations
        relations = db.query(SemanticRelation).all()
        
        return {
            "episodes": [ep.to_dict() for ep in episodes],
            "forgotten": [ep.to_dict() for ep in forgotten],
            "abstractions": [ab.to_dict() for ab in abstractions],
            "entities": [ent.to_dict() for ent in entities],
            "relations": [rel.to_dict() for rel in relations]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/memories/reset", response_model=dict)
def reset_database(db: Session = Depends(get_db)):
    """
    Clears all tables in the SQLite database to reset the simulation state.
    """
    try:
        # Drop all tables and recreate them
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        return {"status": "success", "detail": "Database reset completed."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
