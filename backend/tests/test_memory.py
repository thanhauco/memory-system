import unittest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.models import Base, EpisodicMemory
from app.memory.salience import calculate_salience
from app.memory.forgetting import decay_memories

class TestMemorySystem(unittest.TestCase):
    def setUp(self):
        # Create an in-memory SQLite database for testing
        self.engine = create_engine("sqlite:///:memory:")
        Session = sessionmaker(bind=self.engine)
        self.db = Session()
        Base.metadata.create_all(self.engine)

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(self.engine)

    def test_salience_scoring(self):
        # Ingest a text with important goals and emotional keywords from different categories
        text = "This is a critical milestone! We finally solved the memory leak. I feel thrilled, but I was so worried."
        salience_data = calculate_salience(text, self.db)
        
        self.assertGreater(salience_data["salience"], 0.5)
        self.assertGreater(salience_data["importance"], 0.5)
        self.assertGreater(salience_data["emotion"], 0.5)

    def test_memory_decay(self):
        # Create a test memory
        memory = EpisodicMemory(
            raw_text="Routine checkup of codebase.",
            initial_salience=0.8,
            current_salience=0.8,
            importance=0.2, # low importance decays faster
            novelty=0.5,
            emotion=0.3,
            is_compressed=False,
            is_forgotten=False
        )
        self.db.add(memory)
        self.db.commit()

        # Run decay
        decay_memories(self.db, base_decay_rate=0.2, forget_threshold=0.1, policy="exponential")
        
        # Verify salience decayed
        self.db.refresh(memory)
        self.assertLess(memory.current_salience, 0.8)

    def test_spaced_repetition_decay(self):
        # Create two identical memories, one retrieved often, one not retrieved
        mem1 = EpisodicMemory(
            raw_text="Quantum compiler discussions.",
            initial_salience=0.8,
            current_salience=0.8,
            importance=0.2,
            novelty=0.5,
            emotion=0.3,
            retrieval_count=0,
            is_compressed=False,
            is_forgotten=False
        )
        mem2 = EpisodicMemory(
            raw_text="Compiler optimization plans.",
            initial_salience=0.8,
            current_salience=0.8,
            importance=0.2,
            novelty=0.5,
            emotion=0.3,
            retrieval_count=4, # High recall stabilizes memory
            is_compressed=False,
            is_forgotten=False
        )
        self.db.add_all([mem1, mem2])
        self.db.commit()

        # Run decay with spaced repetition policy
        decay_memories(self.db, base_decay_rate=0.3, forget_threshold=0.1, policy="spaced_repetition")

        self.db.refresh(mem1)
        self.db.refresh(mem2)

        # mem2 (high recalls) should have decayed significantly LESS than mem1 (zero recalls)
        self.assertGreater(mem2.current_salience, mem1.current_salience)
        print(f"\n[TEST INFO] Zero recalls salience: {mem1.current_salience}, High recalls salience: {mem2.current_salience}")

if __name__ == "__main__":
    unittest.main()
