from datetime import datetime
import json
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Table
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

# Join table for EpisodicMemory <-> SemanticEntity (Many-to-Many)
memory_entity_association = Table(
    "memory_entity_association",
    Base.metadata,
    Column("memory_id", Integer, ForeignKey("episodic_memories.id", ondelete="CASCADE"), primary_key=True),
    Column("entity_id", Integer, ForeignKey("semantic_entities.id", ondelete="CASCADE"), primary_key=True)
)

class EpisodicMemory(Base):
    __tablename__ = "episodic_memories"

    id = Column(Integer, primary_key=True, index=True)
    raw_text = Column(String, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow)
    
    # Salience dimensions (0.0 to 1.0)
    initial_salience = Column(Float, nullable=False, default=1.0)
    current_salience = Column(Float, nullable=False, default=1.0)
    importance = Column(Float, nullable=False, default=0.5)
    novelty = Column(Float, nullable=False, default=0.5)
    emotion = Column(Float, nullable=False, default=0.5)
    
    # State flags
    is_compressed = Column(Boolean, default=False)
    is_forgotten = Column(Boolean, default=False)
    parent_abstraction_id = Column(Integer, ForeignKey("abstraction_nodes.id", ondelete="SET NULL"), nullable=True)
    retrieval_count = Column(Integer, default=0)
    
    # Relationships
    entities = relationship("SemanticEntity", secondary=memory_entity_association, back_populates="memories")
    parent_abstraction = relationship("AbstractionNode", back_populates="child_memories")

    def to_dict(self):
        return {
            "id": self.id,
            "raw_text": self.raw_text,
            "timestamp": self.timestamp.isoformat(),
            "initial_salience": self.initial_salience,
            "current_salience": self.current_salience,
            "importance": self.importance,
            "novelty": self.novelty,
            "emotion": self.emotion,
            "is_compressed": self.is_compressed,
            "is_forgotten": self.is_forgotten,
            "parent_abstraction_id": self.parent_abstraction_id,
            "retrieval_count": self.retrieval_count,
            "entities": [entity.name for entity in self.entities]
        }

class SemanticEntity(Base):
    __tablename__ = "semantic_entities"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    type = Column(String, default="Concept") # e.g. Person, Place, Organization, Concept
    description = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    activity_score = Column(Float, default=1.0) # Decay score for entity relevance

    # Relationships
    memories = relationship("EpisodicMemory", secondary=memory_entity_association, back_populates="entities")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "type": self.type,
            "description": self.description,
            "created_at": self.created_at.isoformat(),
            "activity_score": self.activity_score
        }

class SemanticRelation(Base):
    __tablename__ = "semantic_relations"

    id = Column(Integer, primary_key=True, index=True)
    source_id = Column(Integer, ForeignKey("semantic_entities.id", ondelete="CASCADE"), nullable=False)
    target_id = Column(Integer, ForeignKey("semantic_entities.id", ondelete="CASCADE"), nullable=False)
    relation_type = Column(String, default="associated_with") # e.g. met_at, works_on, is_a
    strength = Column(Float, default=1.0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # ORM mapping to entities for easy retrieval
    source = relationship("SemanticEntity", foreign_keys=[source_id])
    target = relationship("SemanticEntity", foreign_keys=[target_id])

    def to_dict(self):
        return {
            "id": self.id,
            "source_id": self.source_id,
            "source_name": self.source.name if self.source else None,
            "target_id": self.target_id,
            "target_name": self.target.name if self.target else None,
            "relation_type": self.relation_type,
            "strength": self.strength,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat()
        }

class AbstractionNode(Base):
    __tablename__ = "abstraction_nodes"

    id = Column(Integer, primary_key=True, index=True)
    summary = Column(String, nullable=False)
    concept_tags_raw = Column(String, default="[]") # JSON list of concepts/themes
    level = Column(Integer, default=1) # Hierarchical depth of abstraction
    created_at = Column(DateTime, default=datetime.utcnow)
    salience_score = Column(Float, default=1.0)
    retrieval_count = Column(Integer, default=0)

    # Relationships
    child_memories = relationship("EpisodicMemory", back_populates="parent_abstraction")

    @property
    def concept_tags(self):
        try:
            return json.loads(self.concept_tags_raw)
        except Exception:
            return []

    @concept_tags.setter
    def concept_tags(self, val):
        self.concept_tags_raw = json.dumps(val)

    def to_dict(self):
        return {
            "id": self.id,
            "summary": self.summary,
            "concept_tags": self.concept_tags,
            "level": self.level,
            "created_at": self.created_at.isoformat(),
            "salience_score": self.salience_score,
            "retrieval_count": self.retrieval_count,
            "child_memory_ids": [m.id for m in self.child_memories]
        }
