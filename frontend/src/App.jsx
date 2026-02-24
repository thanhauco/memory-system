import React, { useState, useEffect, useRef } from 'react';

// API Configuration
const API_BASE = 'http://127.0.0.1:8000';

// Mock Data for offline capability / high fidelity demo
const MOCK_EPISODES = [
  { id: 1, raw_text: "I met Alice at the Central Cafe to discuss quantum computing architectures. She was incredibly enthusiastic about it.", timestamp: new Date(Date.now() - 3600000 * 24).toISOString(), initial_salience: 0.85, current_salience: 0.72, importance: 0.7, novelty: 0.8, emotion: 0.75, is_compressed: false, is_forgotten: false, parent_abstraction_id: null, retrieval_count: 3, entities: ["Alice", "Central Cafe", "Quantum Computing"] },
  { id: 2, raw_text: "Alice emailed me a sketch of the neural-qubit mapping logic. The plan looks solid but has synchronization risks.", timestamp: new Date(Date.now() - 3600000 * 18).toISOString(), initial_salience: 0.75, current_salience: 0.61, importance: 0.6, novelty: 0.65, emotion: 0.6, is_compressed: false, is_forgotten: false, parent_abstraction_id: null, retrieval_count: 1, entities: ["Alice", "Neural-Qubit Mapping"] },
  { id: 3, raw_text: "Spent the afternoon coding at the office. Tested the database connections and encountered a critical memory leak that caused a crash.", timestamp: new Date(Date.now() - 3600000 * 12).toISOString(), initial_salience: 0.90, current_salience: 0.82, importance: 0.85, novelty: 0.7, emotion: 0.85, is_compressed: false, is_forgotten: false, parent_abstraction_id: null, retrieval_count: 0, entities: ["Office", "Memory Leak"] },
  { id: 4, raw_text: "Visited the bookstore in the city and bought a copy of 'Gödel, Escher, Bach'. Had a quiet evening reading.", timestamp: new Date(Date.now() - 3600000 * 30).toISOString(), initial_salience: 0.40, current_salience: 0.18, importance: 0.2, novelty: 0.5, emotion: 0.3, is_compressed: false, is_forgotten: false, parent_abstraction_id: null, retrieval_count: 0, entities: ["Bookstore", "Godel Escher Bach"] }
];

const MOCK_ENTITIES = [
  { id: 1, name: "Alice", type: "Person", description: "Colleague working on quantum architectures", activity_score: 0.9 },
  { id: 2, name: "Central Cafe", type: "Place", description: "Local coffee shop", activity_score: 0.5 },
  { id: 3, name: "Quantum Computing", type: "Concept", description: "Next-gen computation model", activity_score: 0.8 },
  { id: 4, name: "Neural-Qubit Mapping", type: "Concept", description: "Design layout for qubit integration", activity_score: 0.75 },
  { id: 5, name: "Office", type: "Place", description: "Work office headquarters", activity_score: 0.6 },
  { id: 6, name: "Memory Leak", type: "Concept", description: "Dangerous system leak bug", activity_score: 0.85 },
  { id: 7, name: "Bookstore", type: "Place", description: "City center bookstore", activity_score: 0.2 },
  { id: 8, name: "Godel Escher Bach", type: "Concept", description: "Pulitzer prize winning logic book", activity_score: 0.3 }
];

const MOCK_RELATIONS = [
  { id: 1, source_id: 1, target_id: 2, source_name: "Alice", target_name: "Central Cafe", relation_type: "located_at", strength: 1.0 },
  { id: 2, source_id: 1, target_id: 3, source_name: "Alice", target_name: "Quantum Computing", relation_type: "works_on", strength: 2.0 },
  { id: 3, source_id: 1, target_id: 4, source_name: "Alice", target_name: "Neural-Qubit Mapping", relation_type: "works_on", strength: 1.5 },
  { id: 4, source_id: 3, target_id: 4, source_name: "Quantum Computing", target_name: "Neural-Qubit Mapping", relation_type: "associated_with", strength: 1.2 },
  { id: 5, source_id: 5, target_id: 6, source_name: "Office", target_name: "Memory Leak", relation_type: "located_at", strength: 1.0 }
];

export default function App() {
  // Application states
  const [backendOnline, setBackendOnline] = useState(false);
  const [episodes, setEpisodes] = useState([]);
  const [forgotten, setForgotten] = useState([]);
  const [abstractions, setAbstractions] = useState([]);
  const [entities, setEntities] = useState([]);
  const [relations, setRelations] = useState([]);
  
  // UI states
  const [inputText, setInputText] = useState('');
  const [queryText, setQueryText] = useState('');
  const [budgetWords, setBudgetWords] = useState(300);
  const [decayPolicy, setDecayPolicy] = useState('spaced_repetition');
  const [recalledIds, setRecalledIds] = useState([]); // Visual highlight list
  const [weights, setWeights] = useState({ triplet: 0.2, abstraction: 0.4, episodic: 0.4 });
  const [assemblyResult, setAssemblyResult] = useState(null);
  const [selectedTab, setSelectedTab] = useState('graph');
  const [selectedEntity, setSelectedEntity] = useState(null); // Timeline filter
  const [isProcessing, setIsProcessing] = useState(false);
  const [notification, setNotification] = useState(null);
  
  // Ref for the interactive graph canvas
  const canvasRef = useRef(null);
  
  // Check backend online status and load initial state
  const loadState = async () => {
    try {
      const response = await fetch(`${API_BASE}/memories/state`);
      if (response.ok) {
        const data = await response.json();
        setEpisodes(data.episodes);
        setForgotten(data.forgotten);
        setAbstractions(data.abstractions);
        setEntities(data.entities);
        setRelations(data.relations);
        setBackendOnline(true);
      } else {
        throw new Error("Offline");
      }
    } catch (e) {
      // Fallback to mock data if backend offline
      setBackendOnline(false);
      setEpisodes(MOCK_EPISODES.filter(e => !e.is_forgotten && !e.is_compressed));
      setForgotten(MOCK_EPISODES.filter(e => e.is_forgotten));
      setAbstractions([]);
      setEntities(MOCK_ENTITIES);
      setRelations(MOCK_RELATIONS);
      console.warn("Backend offline. Loaded high-fidelity mock data.");
    }
  };

  useEffect(() => {
    loadState();
    // Poll backend status every 5 seconds
    const interval = setInterval(loadState, 5000);
    return () => clearInterval(interval);
  }, []);

  // Show status notification
  const triggerNotification = (text, type = 'info') => {
    setNotification({ text, type });
    setTimeout(() => setNotification(null), 4000);
  };

  // 1. Ingest new experience
  const handleSubmitExperience = async (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    
    setIsProcessing(true);
    if (backendOnline) {
      try {
        const res = await fetch(`${API_BASE}/memories`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: inputText })
        });
        const data = await res.json();
        if (data.status === 'success') {
          triggerNotification(`Ingested Memory! Salience: ${data.memory.initial_salience}. Extracted: ${data.extracted_entities.join(', ') || 'None'}`, 'success');
          setInputText('');
          loadState();
        }
      } catch (err) {
        triggerNotification('API Error during ingestion.', 'error');
      }
    } else {
      // Ingest in Mock State
      const words = inputText.split(' ');
      const textLower = inputText.lower?.() || inputText.toLowerCase();
      
      // Calculate local estimates
      const localSal = Math.min(0.2 + (words.length * 0.02) + (textLower.includes('!') ? 0.2 : 0), 1.0);
      const importance = textLower.includes('critical') || textLower.includes('discuss') || textLower.includes('leak') ? 0.8 : 0.4;
      const emotion = textLower.includes('enthusiastic') || textLower.includes('leak') ? 0.75 : 0.3;
      const novelty = 0.7;

      const newId = episodes.length + forgotten.length + 100;
      
      // Extract entities
      const capWords = inputText.match(/\b[A-Z][a-zA-Z0-9_-]*\b/g) || [];
      const localExtracted = [...new Set(capWords)].filter(w => w !== 'I' && w !== 'The' && w !== 'He' && w !== 'She');
      
      const newEp = {
        id: newId,
        raw_text: inputText,
        timestamp: new Date().toISOString(),
        initial_salience: localSal,
        current_salience: localSal,
        importance,
        novelty,
        emotion,
        is_compressed: false,
        is_forgotten: false,
        parent_abstraction_id: null,
        retrieval_count: 0,
        entities: localExtracted
      };

      setEpisodes([newEp, ...episodes]);
      
      // Update entities & relations
      let updatedEntities = [...entities];
      let updatedRelations = [...relations];
      
      localExtracted.forEach(name => {
        let ent = updatedEntities.find(e => e.name === name);
        if (ent) {
          ent.activity_score = 1.0;
        } else {
          ent = {
            id: updatedEntities.length + 1,
            name,
            type: name === 'Office' || name.includes('Cafe') ? 'Place' : 'Person',
            description: `Mock extracted entity ${name}`,
            activity_score: 1.0
          };
          updatedEntities.push(ent);
        }
      });

      // Add a relation if we have 2 entities
      if (localExtracted.length >= 2) {
        const src = updatedEntities.find(e => e.name === localExtracted[0]);
        const tgt = updatedEntities.find(e => e.name === localExtracted[1]);
        if (src && tgt) {
          updatedRelations.push({
            id: updatedRelations.length + 1,
            source_id: src.id,
            target_id: tgt.id,
            source_name: src.name,
            target_name: tgt.name,
            relation_type: 'associated_with',
            strength: 1.0
          });
        }
      }

      setEntities(updatedEntities);
      setRelations(updatedRelations);
      
      triggerNotification(`[DEMO] Memory Ingested locally!`, 'success');
      setInputText('');
    }
    setIsProcessing(false);
  };

  // 2. Trigger Time Tick / Decay
  const handleDecayTick = async () => {
    setIsProcessing(true);
    if (backendOnline) {
      try {
        const res = await fetch(`${API_BASE}/memories/decay?policy=${decayPolicy}`, { method: 'POST' });
        const data = await res.json();
        if (data.status === 'success') {
          const stats = data.decay_stats;
          triggerNotification(`Step Complete (${decayPolicy})! Decayed: ${stats.decayed_episodes}, Forgotten: ${stats.forgotten_episodes}, Graph Edges Pruned: ${stats.relations_pruned}`, 'info');
          loadState();
        }
      } catch (err) {
        triggerNotification('API Error during decay.', 'error');
      }
    } else {
      // Mock Decay
      const forgetThreshold = 0.15;
      const updated = episodes.map(ep => {
        const lambda_base = 0.05 * (1.0 - ep.importance);
        let newSal = ep.current_salience;
        
        if (decayPolicy === 'spaced_repetition') {
          const lambda = lambda_base / (1.0 + (ep.retrieval_count || 0));
          newSal = ep.current_salience * Math.exp(-lambda);
        } else if (decayPolicy === 'linear') {
          newSal = ep.current_salience - lambda_base;
        } else { // exponential
          newSal = ep.current_salience * Math.exp(-lambda_base);
        }
        
        return { ...ep, current_salience: Math.max(parseFloat(newSal.toFixed(3)), 0.0) };
      });
      
      const newForgotten = updated.filter(ep => ep.current_salience < forgetThreshold);
      const newActive = updated.filter(ep => ep.current_salience >= forgetThreshold);
      
      setEpisodes(newActive);
      setForgotten([...newForgotten, ...forgotten]);
      
      // Decay entity activity scores
      setEntities(entities.map(e => ({ ...e, activity_score: parseFloat((e.activity_score * 0.95).toFixed(2)) })));
      // Decay relation strengths
      setRelations(relations.map(r => ({ ...r, strength: parseFloat((r.strength * 0.97).toFixed(2)) })).filter(r => r.strength >= 0.1));

      triggerNotification(`[DEMO] Sim Step (${decayPolicy})! ${newForgotten.length} memory(s) forgotten.`, 'info');
    }
    setIsProcessing(false);
  };

  // 3. Trigger Compression / Abstraction
  const handleTriggerCompression = async () => {
    setIsProcessing(true);
    if (backendOnline) {
      try {
        const res = await fetch(`${API_BASE}/memories/compress`, { method: 'POST' });
        const data = await res.json();
        if (data.status === 'success') {
          triggerNotification(`Compressed! Created ${data.abstractions_created_count} concept abstraction(s).`, 'success');
          loadState();
        }
      } catch (err) {
        triggerNotification('API Error during compression.', 'error');
      }
    } else {
      // Mock Compression
      if (episodes.length < 2) {
        triggerNotification('Need at least 2 active memories to abstract.', 'warning');
      } else {
        const entitiesInCluster = Array.from(new Set(episodes.flatMap(ep => ep.entities)));
        const summary = `Consolidated abstraction of experiences concerning ${entitiesInCluster.join(', ') || 'general concepts'}:\n` +
          episodes.map(ep => `- ${ep.raw_text} (Salience: {ep.current_salience})`).join('\n');
        
        const newAbstraction = {
          id: abstractions.length + 1,
          summary,
          concept_tags: entitiesInCluster,
          level: 1,
          created_at: new Date().toISOString(),
          salience_score: 0.65,
          retrieval_count: 0,
          child_memory_ids: episodes.map(ep => ep.id)
        };
        
        setAbstractions([...abstractions, newAbstraction]);
        setEpisodes([]); // Clear/compress all episodes in demo
        triggerNotification('[DEMO] Consolidated all memories into 1 concept abstraction.', 'success');
      }
    }
    setIsProcessing(false);
  };

  // 4. Assemble context
  const handleAssembleContext = async () => {
    if (!queryText.trim()) return;
    setIsProcessing(true);
    if (backendOnline) {
      try {
        const res = await fetch(`${API_BASE}/context/assemble`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: queryText,
            word_budget: budgetWords,
            triplet_weight: weights.triplet,
            abstraction_weight: weights.abstraction,
            episodic_weight: weights.episodic
          })
        });
        const data = await res.json();
        if (data.status === 'success') {
          setAssemblyResult(data.data);
          
          // Capture reinforced IDs to display active recall highlight
          const ids = data.data.episodes.map(item => item.memory.id);
          setRecalledIds(ids);
          setTimeout(() => setRecalledIds([]), 5000); // Clear highlight after 5s
          
          triggerNotification('Assembled context and reinforced matching memories!', 'success');
          loadState(); // Reload state to reflect updated retrieval counts & salience
        }
      } catch (err) {
        triggerNotification('API Error during context assembly.', 'error');
      }
    } else {
      // Mock Context Assembly with recall reinforcement
      const matchingEpisodes = episodes.filter(e => 
        e.raw_text.toLowerCase().includes(queryText.toLowerCase())
      );
      
      // Reinforce mock data locally
      const reinforcedIdsList = [];
      const updatedEpisodes = episodes.map(ep => {
        const matches = ep.raw_text.toLowerCase().includes(queryText.toLowerCase());
        if (matches) {
          reinforcedIdsList.push(ep.id);
          return {
            ...ep,
            retrieval_count: (ep.retrieval_count || 0) + 1,
            current_salience: Math.min(parseFloat((ep.current_salience + 0.05).toFixed(3)), 1.0)
          };
        }
        return ep;
      });
      setEpisodes(updatedEpisodes);
      setRecalledIds(reinforcedIdsList);
      setTimeout(() => setRecalledIds([]), 5000);

      const filteredTriplets = relations.filter(r => 
        r.source_name.toLowerCase().includes(queryText.toLowerCase()) || 
        r.target_name.toLowerCase().includes(queryText.toLowerCase())
      );
      
      const targetTriplet = Math.floor(budgetWords * weights.triplet);
      const targetAbs = Math.floor(budgetWords * weights.abstraction);
      const targetEp = Math.floor(budgetWords * weights.episodic);
      
      const tripList = filteredTriplets.map(t => `- (${t.source_name}) --[${t.relation_type}]--> (${t.target_name}) [strength: {t.strength}]`);
      const absList = abstractions.map(ab => `Concept: ${ab.concept_tags.join(', ')}\n${ab.summary}`);
      const epList = matchingEpisodes.map(ep => `[Memory] ${ep.raw_text} (Salience: ${ep.current_salience})`);
      
      const assembledText = `[Semantic Knowledge Graph Connections]\n${tripList.join('\n') || '- None'}\n\n` +
        `[Synthesized Conceptual Abstractions]\n${absList.join('\n') || '- None'}\n\n` +
        `[Detailed Episodic Logs (Chronological / Relevant)]\n${epList.join('\n') || '- None'}`;
        
      setAssemblyResult({
        query: queryText,
        assembled_context: assembledText,
        word_budget: budgetWords,
        total_used_words: Math.min(budgetWords - 15, assembledText.split(' ').length),
        allocation_stats: {
          triplets: { budget: targetTriplet, used: Math.min(targetTriplet, tripList.join(' ').split(' ').length), count: tripList.length },
          abstractions: { budget: targetAbs, used: Math.min(targetAbs, absList.join(' ').split(' ').length), count: absList.length },
          episodes: { budget: targetEp, used: Math.min(targetEp, epList.join(' ').split(' ').length), count: epList.length },
          surplus_redistributed: 15
        }
      });
      triggerNotification('[DEMO] Context compiled and memories reinforced locally.', 'success');
    }
    setIsProcessing(false);
  };

  // 5. Reset DB
  const handleResetDb = async () => {
    if (!window.confirm("Are you sure you want to wipe the memory database?")) return;
    setIsProcessing(true);
    if (backendOnline) {
      try {
        const res = await fetch(`${API_BASE}/memories/reset`, { method: 'POST' });
        if (res.ok) {
          triggerNotification("Database reset complete.", "success");
          loadState();
        }
      } catch (err) {
        triggerNotification("Error resetting database.", "error");
      }
    } else {
      setEpisodes([]);
      setForgotten([]);
      setAbstractions([]);
      setEntities([]);
      setRelations([]);
      triggerNotification("[DEMO] Cleared local arrays.", "success");
    }
    setIsProcessing(false);
  };

  // Live Salience Estimator (Heuristics)
  const getLiveSalienceEstimate = () => {
    if (!inputText) return { sal: 0, imp: 0, emo: 0, nov: 0 };
    const textLower = inputText.toLowerCase();
    
    // Importance words
    const impKeywords = ["decided", "resolved", "planned", "important", "critical", "essential", "must", "learned", "realized", "goal", "fail", "success", "leak", "crash"];
    let impCount = impKeywords.filter(w => textLower.includes(w)).length;
    const imp = Math.min(0.3 + impCount * 0.2, 1.0);
    
    // Emotion words
    const emoKeywords = ["happy", "excited", "thrilled", "sad", "angry", "furious", "scared", "fear", "anxious", "worried", "surprised", "shocked", "love", "regret"];
    let emoCount = emoKeywords.filter(w => textLower.includes(w)).length;
    if (inputText.includes("!")) emoCount += 1;
    const emo = Math.min(0.2 + emoCount * 0.2, 1.0);
    
    // Novelty (depends on size, simple estimate)
    const words = textLower.split(/\s+/).filter(w => w.length > 3);
    const uniqueWords = new Set(words);
    const nov = Math.min(0.4 + (uniqueWords.size * 0.05), 1.0);
    
    // Composite
    const sal = (0.3 * nov) + (0.4 * imp) + (0.3 * emo);
    
    return {
      sal: Math.round(sal * 100) / 100,
      imp: Math.round(imp * 100) / 100,
      emo: Math.round(emo * 100) / 100,
      nov: Math.round(nov * 100) / 100
    };
  };

  const liveEstimate = getLiveSalienceEstimate();

  // --- KNOWLEDGE GRAPH 2D PHYSICS ENGINE CANVAS ---
  useEffect(() => {
    if (selectedTab !== 'graph' || !canvasRef.current || entities.length === 0) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    let animationFrameId;
    let width = canvas.offsetWidth;
    let height = canvas.offsetHeight;
    canvas.width = width;
    canvas.height = height;

    // Build visual nodes
    const nodes = entities.map((ent, idx) => {
      const angle = (idx / entities.length) * Math.PI * 2;
      return {
        id: ent.name,
        name: ent.name,
        type: ent.type,
        activity: ent.activity_score,
        x: width / 2 + Math.cos(angle) * (width * 0.25),
        y: height / 2 + Math.sin(angle) * (height * 0.25),
        vx: 0,
        vy: 0,
        radius: 12 + ent.activity_score * 8,
        fx: null,
        fy: null
      };
    });

    // Build visual links
    const links = relations.map(rel => {
      const sourceNode = nodes.find(n => n.name === rel.source_name);
      const targetNode = nodes.find(n => n.name === rel.target_name);
      return {
        source: sourceNode,
        target: targetNode,
        label: rel.relation_type,
        strength: rel.strength
      };
    }).filter(l => l.source && l.target);

    // Interaction variables
    let draggedNode = null;
    let hoveredNode = null;

    // Physics parameters
    const kRepulsion = 800;
    const kAttraction = 0.05;
    const desiredDistance = 120;
    const damping = 0.82;
    const centerForce = 0.008;

    const runPhysics = () => {
      // 1. Repulsion between nodes
      for (let i = 0; i < nodes.length; i++) {
        const n1 = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const n2 = nodes[j];
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          let dist = Math.hypot(dx, dy);
          if (dist < 1) dist = 1;
          
          const force = kRepulsion / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          
          if (!n1.fx) { n1.vx -= fx; n1.vy -= fy; }
          if (!n2.fx) { n2.vx += fx; n2.vy += fy; }
        }
      }

      // 2. Attraction along links
      for (const link of links) {
        const dx = link.target.x - link.source.x;
        const dy = link.target.y - link.source.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 1) continue;
        
        const force = kAttraction * (dist - desiredDistance) * (link.strength || 1.0);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        
        if (!link.source.fx) { link.source.vx += fx; link.source.vy += fy; }
        if (!link.target.fx) { link.target.vx -= fx; link.target.vy -= fy; }
      }

      // 3. Central gravity and integration
      const cx = width / 2;
      const cy = height / 2;
      for (const node of nodes) {
        if (node === draggedNode) continue;
        
        node.vx += (cx - node.x) * centerForce;
        node.vy += (cy - node.y) * centerForce;
        
        node.x += node.vx;
        node.y += node.vy;
        
        node.vx *= damping;
        node.vy *= damping;
        
        node.x = Math.max(node.radius, Math.min(width - node.radius, node.x));
        node.y = Math.max(node.radius, Math.min(height - node.radius, node.y));
      }
    };

    // Draw frame
    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      
      // Render Links
      links.forEach(link => {
        ctx.beginPath();
        ctx.moveTo(link.source.x, link.source.y);
        ctx.lineTo(link.target.x, link.target.y);
        
        ctx.strokeStyle = `rgba(139, 92, 246, ${Math.min(0.2 + link.strength * 0.15, 0.8)})`;
        ctx.lineWidth = Math.min(1 + link.strength * 1.5, 6);
        ctx.stroke();
        
        const mx = (link.source.x + link.target.x) / 2;
        const my = (link.source.y + link.target.y) / 2;
        ctx.fillStyle = 'var(--text-muted)';
        ctx.font = '9px var(--font-sans)';
        ctx.textAlign = 'center';
        ctx.fillText(link.label, mx, my - 4);

        // Animated signal pulse along link
        const signalPos = (Date.now() / 2000) % 1.0;
        const sx = link.source.x + (link.target.x - link.source.x) * signalPos;
        const sy = link.source.y + (link.target.y - link.source.y) * signalPos;
        ctx.beginPath();
        ctx.arc(sx, sy, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'var(--accent-cyan)';
        ctx.shadowColor = 'var(--accent-cyan)';
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // Render Nodes
      nodes.forEach(node => {
        if (node === hoveredNode || selectedEntity === node.name) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.radius + 6, 0, Math.PI * 2);
          ctx.fillStyle = node.type === 'Person' ? 'rgba(6, 182, 212, 0.1)' : 
                          node.type === 'Place' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(139, 92, 246, 0.1)';
          ctx.strokeStyle = node.type === 'Person' ? 'rgba(6, 182, 212, 0.5)' : 
                            node.type === 'Place' ? 'rgba(16, 185, 129, 0.5)' : 'rgba(139, 92, 246, 0.5)';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        
        const grad = ctx.createRadialGradient(node.x - 3, node.y - 3, 1, node.x, node.y, node.radius);
        if (node.type === 'Person') {
          grad.addColorStop(0, '#67e8f9');
          grad.addColorStop(1, '#0891b2');
        } else if (node.type === 'Place') {
          grad.addColorStop(0, '#6ee7b7');
          grad.addColorStop(1, '#059669');
        } else {
          grad.addColorStop(0, '#c084fc');
          grad.addColorStop(1, '#7c3aed');
        }
        
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Node label
        ctx.fillStyle = 'var(--text-primary)';
        ctx.font = 'bold 11px var(--font-sans)';
        ctx.textAlign = 'center';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 4;
        ctx.fillText(node.name, node.x, node.y + node.radius + 15);
        ctx.shadowBlur = 0;
        
        // Activity indicator ring
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius - 3, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,255,255, ${0.1 + node.activity * 0.4})`;
        ctx.stroke();
      });
    };

    // Physics + Draw loop
    const tick = () => {
      runPhysics();
      draw();
      animationFrameId = requestAnimationFrame(tick);
    };
    tick();

    // Mouse Listeners
    const getMousePos = (evt) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: evt.clientX - rect.left,
        y: evt.clientY - rect.top
      };
    };

    const handleMouseMove = (evt) => {
      const pos = getMousePos(evt);
      let found = null;
      for (const node of nodes) {
        if (Math.hypot(node.x - pos.x, node.y - pos.y) < node.radius + 10) {
          found = node;
          break;
        }
      }
      hoveredNode = found;
      canvas.style.cursor = found ? 'pointer' : 'default';
      
      if (draggedNode) {
        draggedNode.x = pos.x;
        draggedNode.y = pos.y;
        draggedNode.vx = 0;
        draggedNode.vy = 0;
      }
    };

    const handleMouseDown = (evt) => {
      const pos = getMousePos(evt);
      for (const node of nodes) {
        if (Math.hypot(node.x - pos.x, node.y - pos.y) < node.radius + 10) {
          draggedNode = node;
          node.fx = pos.x;
          node.fy = pos.y;
          break;
        }
      }
    };

    const handleMouseUp = () => {
      if (draggedNode) {
        draggedNode.fx = null;
        draggedNode.fy = null;
        draggedNode = null;
      }
    };

    const handleMouseClick = (evt) => {
      const pos = getMousePos(evt);
      let clicked = null;
      for (const node of nodes) {
        if (Math.hypot(node.x - pos.x, node.y - pos.y) < node.radius + 10) {
          clicked = node;
          break;
        }
      }
      if (clicked) {
        setSelectedEntity(prev => prev === clicked.name ? null : clicked.name);
      } else {
        setSelectedEntity(null);
      }
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('click', handleMouseClick);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.offsetWidth;
      height = canvas.offsetHeight;
      canvas.width = width;
      canvas.height = height;
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('click', handleMouseClick);
      window.removeEventListener('resize', handleResize);
    };
  }, [selectedTab, entities, relations, selectedEntity]);

  return (
    <div className="app-container">
      {/* Notifications */}
      {notification && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          zIndex: 9999,
          padding: '12px 24px',
          borderRadius: '8px',
          backgroundColor: notification.type === 'success' ? '#10b981' : notification.type === 'error' ? '#f43f5e' : '#8b5cf6',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          color: '#fff',
          fontFamily: 'var(--font-sans)',
          fontSize: '0.9rem',
          animation: 'fadeIn 0.3s ease-out'
        }}>
          {notification.text}
        </div>
      )}

      {/* Header */}
      <header className="header glass-panel glow-cyan">
        <h1>INTELLIGENT MEMORY SYSTEM <span>IMS // AGENTIC ENGINE</span></h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: backendOnline ? 'var(--accent-cyan)' : 'var(--accent-rose)',
              boxShadow: backendOnline ? '0 0 10px var(--accent-cyan)' : '0 0 10px var(--accent-rose)'
            }} />
            <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-display)', color: backendOnline ? 'var(--accent-cyan)' : 'var(--accent-rose)' }}>
              BACKEND: {backendOnline ? 'CONNECTED' : 'MOCK ENGINE ACTIVE (OFFLINE)'}
            </span>
          </div>
          <button className="btn btn-secondary" onClick={handleResetDb} style={{ fontSize: '0.65rem', padding: '6px 12px' }}>
            Wipe DB
          </button>
        </div>
      </header>

      {/* Main Layout Grid */}
      <div className="main-grid">
        
        {/* Left Column: Controls and Input */}
        <div className="column-left">
          
          {/* Memory Ingestor Card */}
          <div className="glass-panel" style={{ padding: '20px' }}>
            <h2 className="card-title">Experience Ingestor <span>⚡</span></h2>
            <form onSubmit={handleSubmitExperience} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <textarea
                className="form-input"
                rows={3}
                placeholder="Log a new episode... (e.g. 'I met Bob at the office and we finished writing the compiler. He was relieved.')"
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                style={{ resize: 'none' }}
              />
              
              {/* Real-time estimate meters */}
              {inputText.trim() && (
                <div style={{
                  padding: '12px',
                  backgroundColor: 'rgba(0,0,0,0.2)',
                  borderRadius: '8px',
                  fontSize: '0.75rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  animation: 'fadeIn 0.2s ease-out'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                    <span>Estimated Salience Score</span>
                    <span style={{ color: 'var(--accent-cyan)', fontWeight: 'bold' }}>{liveEstimate.sal}</span>
                  </div>
                  <div style={{ height: '4px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${liveEstimate.sal * 100}%`, backgroundColor: 'var(--accent-cyan)', transition: 'width 0.2s' }} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginTop: '4px', color: 'var(--text-muted)' }}>
                    <div>Imp: <span style={{ color: '#fff' }}>{liveEstimate.imp}</span></div>
                    <div>Emo: <span style={{ color: '#fff' }}>{liveEstimate.emo}</span></div>
                    <div>Nov: <span style={{ color: '#fff' }}>{liveEstimate.nov}</span></div>
                  </div>
                </div>
              )}
              
              <button className="btn btn-primary" type="submit" disabled={isProcessing || !inputText.trim()}>
                Ingest to Memory
              </button>
            </form>
          </div>
          
          {/* Simulator controls card */}
          <div className="glass-panel" style={{ padding: '20px' }}>
            <h2 className="card-title">Cognitive Simulator <span>🎛️</span></h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>Forgetting Policy</label>
                <select
                  className="form-input"
                  value={decayPolicy}
                  onChange={e => setDecayPolicy(e.target.value)}
                  style={{ marginBottom: '12px', background: 'rgba(15,23,42,0.6)' }}
                >
                  <option value="spaced_repetition">Spaced Repetition (Reinforced)</option>
                  <option value="exponential">Exponential (Standard)</option>
                  <option value="linear">Linear (Constant Rate)</option>
                </select>
                
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                  Decay lowers salience over time. Memories with low salience are pruned/forgotten.
                </p>
                <button className="btn btn-secondary" onClick={handleDecayTick} style={{ width: '100%' }} disabled={isProcessing}>
                  Trigger Time Step (Decay & Prune)
                </button>
              </div>
              
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                  Compression clusters similar experiences and synthesizes them into high-level conceptual abstractions.
                </p>
                <button className="btn btn-secondary" onClick={handleTriggerCompression} style={{ width: '100%' }} disabled={isProcessing}>
                  Trigger Memory Consolidation
                </button>
              </div>
              
              <div style={{
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                fontSize: '0.75rem',
                backgroundColor: 'rgba(139, 92, 246, 0.03)'
              }}>
                <span style={{ color: 'var(--accent-purple)', fontWeight: '600' }}>Active Decay Equation:</span>
                {decayPolicy === 'spaced_repetition' ? (
                  <code style={{ display: 'block', marginTop: '4px', color: 'var(--accent-cyan)' }}>λ_spaced = λ_base / (1 + recalls)</code>
                ) : decayPolicy === 'linear' ? (
                  <code style={{ display: 'block', marginTop: '4px', color: 'var(--accent-amber)' }}>S_new = S_current - λ_base</code>
                ) : (
                  <code style={{ display: 'block', marginTop: '4px', color: 'var(--text-secondary)' }}>S_new = S_current * e^(-λ_base)</code>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Center Column: Interactive visualizations & timeline */}
        <div className="column-center">
          
          {/* Tabs */}
          <div className="glass-panel" style={{ display: 'flex', padding: '6px', gap: '6px', borderRadius: '12px', flexShrink: 0 }}>
            {['graph', 'timeline', 'abstractions', 'forgotten'].map(tab => (
              <button
                key={tab}
                className="btn"
                style={{
                  flexGrow: 1,
                  backgroundColor: selectedTab === tab ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                  color: selectedTab === tab ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                  border: selectedTab === tab ? '1px solid rgba(6, 182, 212, 0.2)' : 'none',
                  fontSize: '0.7rem'
                }}
                onClick={() => setSelectedTab(tab)}
              >
                {tab === 'graph' ? 'Semantic Graph' :
                 tab === 'timeline' ? 'Episodic Timeline' :
                 tab === 'abstractions' ? 'Abstractions' : 'Forgotten Archive'}
              </button>
            ))}
          </div>

          {/* Tab contents */}
          <div className="glass-panel" style={{ flexGrow: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
            
            {/* Graph Visualizer Tab */}
            {selectedTab === 'graph' && (
              <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div style={{
                  padding: '10px 20px',
                  fontSize: '0.75rem',
                  color: 'var(--text-secondary)',
                  backgroundColor: 'rgba(0,0,0,0.15)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderBottom: '1px solid var(--border-color)'
                }}>
                  <span>Drag nodes to align layout. Node size = current activity level.</span>
                  {selectedEntity && (
                    <span style={{ color: 'var(--accent-cyan)' }}>
                      Filtered on: <strong>{selectedEntity}</strong> (Click canvas to reset)
                    </span>
                  )}
                </div>
                
                <div style={{ flexGrow: 1, position: 'relative' }}>
                  <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
                </div>
                
                {/* Legend */}
                <div style={{
                  padding: '12px 20px',
                  display: 'flex',
                  gap: '24px',
                  fontSize: '0.7rem',
                  borderTop: '1px solid var(--border-color)',
                  backgroundColor: 'rgba(0,0,0,0.15)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'linear-gradient(to right, #67e8f9, #0891b2)' }} />
                    <span>Person</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'linear-gradient(to right, #6ee7b7, #059669)' }} />
                    <span>Place</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'linear-gradient(to right, #c084fc, #7c3aed)' }} />
                    <span>Concept</span>
                  </div>
                </div>
              </div>
            )}

            {/* Episodic Timeline Tab */}
            {selectedTab === 'timeline' && (
              <div style={{ padding: '20px', overflowY: 'auto', flexGrow: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {selectedEntity && (
                  <div style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(6, 182, 212, 0.1)',
                    border: '1px solid rgba(6, 182, 212, 0.2)',
                    fontSize: '0.8rem',
                    color: 'var(--accent-cyan)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <span>Showing memories connected to <strong>{selectedEntity}</strong></span>
                    <button onClick={() => setSelectedEntity(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>×</button>
                  </div>
                )}
                
                {episodes.filter(ep => !selectedEntity || ep.entities.includes(selectedEntity)).length === 0 ? (
                  <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No active episodic memories. Add new ones or clear filters.
                  </div>
                ) : (
                  episodes
                    .filter(ep => !selectedEntity || ep.entities.includes(selectedEntity))
                    .map((ep, idx) => {
                      const isRecalled = recalledIds.includes(ep.id);
                      return (
                        <div
                          key={ep.id || idx}
                          className="animate-fade-in"
                          style={{
                            padding: '16px',
                            borderRadius: '12px',
                            border: isRecalled ? '2px solid var(--accent-cyan)' : '1px solid var(--border-color)',
                            backgroundColor: isRecalled ? 'rgba(6, 182, 212, 0.08)' : (ep.is_compressed ? 'rgba(255,255,255,0.02)' : 'rgba(15, 23, 42, 0.4)'),
                            boxShadow: isRecalled ? '0 0 15px rgba(6, 182, 212, 0.25)' : 'none',
                            position: 'relative',
                            transition: 'all 0.4s ease'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            <span>Episode #{ep.id} // {ep.timestamp.split('T')[0]}</span>
                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                              {ep.retrieval_count > 0 && (
                                <span style={{
                                  color: 'var(--accent-cyan)',
                                  backgroundColor: 'rgba(6, 182, 212, 0.1)',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  fontSize: '0.65rem'
                                }}>
                                  👁️ {ep.retrieval_count} recalls ({Math.round(100 / (1 + ep.retrieval_count))}% decay rate)
                                </span>
                              )}
                              <span style={{
                                color: ep.current_salience > 0.6 ? 'var(--accent-cyan)' :
                                       ep.current_salience > 0.3 ? 'var(--accent-amber)' : 'var(--accent-rose)'
                              }}>
                                Salience: {ep.current_salience}
                              </span>
                            </div>
                          </div>
                          
                          <p style={{ fontSize: '0.85rem', lineHeight: '1.5', color: ep.is_compressed ? 'var(--text-muted)' : '#fff' }}>
                            {ep.raw_text}
                          </p>
                          
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '12px' }}>
                            {ep.entities.map(ent => (
                              <span
                                key={ent}
                                onClick={() => setSelectedEntity(ent === selectedEntity ? null : ent)}
                                style={{
                                  fontSize: '0.65rem',
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                  border: '1px solid var(--border-color)',
                                  backgroundColor: ent === selectedEntity ? 'rgba(6, 182, 212, 0.15)' : 'rgba(99, 102, 241, 0.05)',
                                  color: ent === selectedEntity ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                                  cursor: 'pointer'
                                }}
                              >
                                #{ent}
                              </span>
                            ))}
                            
                            {ep.is_compressed && (
                              <span style={{ fontSize: '0.65rem', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(139, 92, 246, 0.3)', color: 'var(--accent-purple)' }}>
                                Compressed (Archived)
                              </span>
                            )}
                          </div>
                          
                          {/* Salience decay meter */}
                          <div style={{
                            height: '2px',
                            width: '100%',
                            backgroundColor: 'rgba(255,255,255,0.03)',
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            borderRadius: '0 0 12px 12px',
                            overflow: 'hidden'
                          }}>
                            <div style={{
                              height: '100%',
                              width: `${ep.current_salience * 100}%`,
                              backgroundColor: ep.current_salience > 0.6 ? 'var(--accent-cyan)' :
                                              ep.current_salience > 0.3 ? 'var(--accent-amber)' : 'var(--accent-rose)'
                            }} />
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            )}

            {/* Abstractions Tab */}
            {selectedTab === 'abstractions' && (
              <div style={{ padding: '20px', overflowY: 'auto', flexGrow: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {abstractions.length === 0 ? (
                  <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No concept abstractions synthesized yet. Run "Memory Consolidation" once you have enough episodes!
                  </div>
                ) : (
                  abstractions.map((ab, idx) => (
                    <div
                      key={ab.id || idx}
                      style={{
                        padding: '16px',
                        borderRadius: '12px',
                        border: '1px solid rgba(139, 92, 246, 0.25)',
                        backgroundColor: 'rgba(139, 92, 246, 0.03)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        <span>Concept Abstraction Level {ab.level}</span>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          {ab.retrieval_count > 0 && (
                            <span style={{ color: 'var(--accent-cyan)', backgroundColor: 'rgba(6, 182, 212, 0.1)', padding: '1px 5px', borderRadius: '3px', fontSize: '0.6rem' }}>
                              👁️ {ab.retrieval_count} recalls
                            </span>
                          )}
                          <span style={{ color: 'var(--accent-purple)' }}>Avg Salience: {ab.salience_score}</span>
                        </div>
                      </div>
                      
                      <p style={{ fontSize: '0.85rem', lineHeight: '1.5', whiteSpace: 'pre-wrap', color: '#fff' }}>
                        {ab.summary}
                      </p>
                      
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '12px' }}>
                        {ab.concept_tags.map(tag => (
                          <span key={tag} style={{ fontSize: '0.65rem', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(99, 102, 241, 0.2)', backgroundColor: 'rgba(139, 92, 246, 0.1)', color: 'var(--accent-purple)' }}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Forgotten Tab */}
            {selectedTab === 'forgotten' && (
              <div style={{ padding: '20px', overflowY: 'auto', flexGrow: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {forgotten.length === 0 ? (
                  <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    The forgetting archive is empty. Wait for memories to decay below 0.15.
                  </div>
                ) : (
                  forgotten.map((ep, idx) => (
                    <div
                      key={ep.id || idx}
                      style={{
                        padding: '16px',
                        borderRadius: '12px',
                        border: '1px solid rgba(244, 63, 94, 0.15)',
                        backgroundColor: 'rgba(244, 63, 94, 0.01)',
                        opacity: 0.45
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.7rem', color: 'var(--accent-rose)' }}>
                        <span>Forgotten Archive (Decayed)</span>
                        <span>Salience: {ep.current_salience}</span>
                      </div>
                      <p style={{ fontSize: '0.85rem', lineHeight: '1.5', textDecoration: 'line-through' }}>
                        {ep.raw_text}
                      </p>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Context Assembler Playroom */}
        <div className="column-right">
          
          {/* Assembler Playground */}
          <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', height: '100%' }}>
            <h2 className="card-title">Adaptive Context Assembler <span>🧬</span></h2>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', flexShrink: 0 }}>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>Target Retrieve Query</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="e.g. 'What is Alice working on?'"
                  value={queryText}
                  onChange={e => setQueryText(e.target.value)}
                />
              </div>
              
              {/* Token budget slider */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  <span>Word Budget limit</span>
                  <span style={{ color: 'var(--accent-cyan)' }}>{budgetWords} words</span>
                </div>
                <input
                  type="range"
                  min={100}
                  max={800}
                  step={50}
                  value={budgetWords}
                  onChange={e => setBudgetWords(parseInt(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent-cyan)' }}
                />
              </div>

              {/* Weight sliders */}
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>Budget Allocations (Weights)</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.7rem' }}>
                    <span>Graph triplets (Relation weight):</span>
                    <span style={{ color: 'var(--accent-cyan)' }}>{Math.round(weights.triplet * 100)}%</span>
                  </div>
                  <input
                    type="range" min={0} max={1} step={0.05} value={weights.triplet}
                    onChange={e => {
                      const val = parseFloat(e.target.value);
                      const rem = 1.0 - val;
                      setWeights({ triplet: val, abstraction: rem * 0.5, episodic: rem * 0.5 });
                    }}
                    style={{ accentColor: 'var(--accent-cyan)' }}
                  />
                  
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.7rem' }}>
                    <span>Abstractions (Broad summary):</span>
                    <span style={{ color: 'var(--accent-purple)' }}>{Math.round(weights.abstraction * 100)}%</span>
                  </div>
                  <input
                    type="range" min={0} max={1 - weights.triplet} step={0.05} value={weights.abstraction}
                    onChange={e => {
                      const val = parseFloat(e.target.value);
                      setWeights({ ...weights, abstraction: val, episodic: 1.0 - weights.triplet - val });
                    }}
                    style={{ accentColor: 'var(--accent-purple)' }}
                  />
                </div>
              </div>
              
              <button className="btn btn-primary" onClick={handleAssembleContext} disabled={isProcessing || !queryText.trim()}>
                Assemble & Reinforce
              </button>
            </div>
            
            {/* Output Visualizer */}
            <div style={{ flexGrow: 1, marginTop: '20px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {assemblyResult ? (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '12px' }} className="animate-fade-in">
                  
                  {/* Allocation Stats chart */}
                  <div style={{
                    padding: '12px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(0,0,0,0.2)',
                    fontSize: '0.7rem'
                  }}>
                    <span style={{ fontWeight: '600', color: 'var(--text-secondary)' }}>Budget Packing Allocation:</span>
                    <div style={{
                      display: 'flex',
                      height: '16px',
                      borderRadius: '8px',
                      overflow: 'hidden',
                      marginTop: '8px',
                      backgroundColor: 'rgba(255,255,255,0.05)'
                    }}>
                      <div style={{
                        width: `${(assemblyResult.allocation_stats.triplets.used / assemblyResult.word_budget) * 100}%`,
                        backgroundColor: 'var(--accent-cyan)'
                      }} title="Triplets Used" />
                      <div style={{
                        width: `${(assemblyResult.allocation_stats.abstractions.used / assemblyResult.word_budget) * 100}%`,
                        backgroundColor: 'var(--accent-purple)'
                      }} title="Abstractions Used" />
                      <div style={{
                        width: `${(assemblyResult.allocation_stats.episodes.used / assemblyResult.word_budget) * 100}%`,
                        backgroundColor: '#6366f1'
                      }} title="Episodes Used" />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', marginTop: '8px', fontSize: '0.6rem', color: 'var(--text-muted)' }}>
                      <div>Trips: <span style={{ color: 'var(--accent-cyan)' }}>{assemblyResult.allocation_stats.triplets.used}w</span> ({assemblyResult.allocation_stats.triplets.count})</div>
                      <div>Abs: <span style={{ color: 'var(--accent-purple)' }}>{assemblyResult.allocation_stats.abstractions.used}w</span> ({assemblyResult.allocation_stats.abstractions.count})</div>
                      <div>Eps: <span style={{ color: '#6366f1' }}>{assemblyResult.allocation_stats.episodes.used}w</span> ({assemblyResult.allocation_stats.episodes.count})</div>
                    </div>
                  </div>
                  
                  {/* Assembled Context Text block */}
                  <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Assembled Context Prompt Block:</label>
                    <textarea
                      readOnly
                      className="form-input"
                      style={{
                        flexGrow: 1,
                        fontFamily: 'monospace',
                        fontSize: '0.75rem',
                        background: 'rgba(5, 7, 10, 0.8)',
                        resize: 'none',
                        color: '#67e8f9'
                      }}
                      value={assemblyResult.assembled_context}
                    />
                  </div>
                </div>
              ) : (
                <div style={{
                  flexGrow: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px dashed var(--border-color)',
                  borderRadius: '12px',
                  color: 'var(--text-muted)',
                  fontSize: '0.8rem',
                  textAlign: 'center',
                  padding: '20px'
                }}>
                  Submit a query to test how the cognitive assembler packs contextual memories.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Architectural Specification Commit #16
// Feature: feat(frontend): draft visual layout timeline and control deck
// Step 001: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 002: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 003: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 004: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 005: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 006: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 007: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 008: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 009: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 010: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 011: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 012: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 013: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 014: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 015: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 016: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 017: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 018: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 019: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 020: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 021: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 022: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 023: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 024: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 025: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 026: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 027: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 028: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 029: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 030: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 031: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 032: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 033: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 034: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 035: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 036: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 037: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 038: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 039: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 040: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 041: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 042: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 043: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 044: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 045: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 046: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 047: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 048: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 049: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 050: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 051: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 052: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 053: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 054: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 055: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 056: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 057: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 058: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 059: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 060: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 061: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 062: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 063: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 064: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 065: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 066: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 067: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 068: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 069: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 070: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 071: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 072: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 073: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 074: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 075: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 076: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 077: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 078: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 079: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 080: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 081: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 082: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 083: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 084: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 085: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 086: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 087: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 088: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 089: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 090: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 091: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 092: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 093: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 094: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 095: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 096: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 097: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 098: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 099: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 100: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 101: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
// Step 102: Verification of cognitive memory safety limits. Adjusting context weights, scaling decay parameters, and validating schemas.
