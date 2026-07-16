// Math roadmap seed: nodes grouped by branch, prerequisite edges (solid),
// and application/relevance edges (dotted).

export type SeedNodeLevel = 'FOUNDATION' | 'CORE' | 'ADVANCED' | 'TARGET';

export interface SeedNode {
  slug: string;
  title: string;
  branch: string;
  level: SeedNodeLevel;
  isTarget?: boolean;
  description?: string;
}

export interface SeedEdge {
  from: string;
  to: string;
  kind?: 'PREREQUISITE' | 'APPLICATION';
}

const F = 'FOUNDATION' as const;
const C = 'CORE' as const;
const A = 'ADVANCED' as const;
const T = 'TARGET' as const;

export const MATH_NODES: SeedNode[] = [
  // Foundations
  { slug: 'algebra-1', title: 'Algebra 1', branch: 'Foundations', level: F },
  { slug: 'algebra-2', title: 'Algebra 2', branch: 'Foundations', level: F },
  { slug: 'geometry', title: 'Geometry', branch: 'Foundations', level: F },
  { slug: 'trigonometry', title: 'Trigonometry', branch: 'Foundations', level: F },
  { slug: 'precalculus', title: 'Precalculus', branch: 'Foundations', level: F },
  { slug: 'calculus-1', title: 'Calculus 1', branch: 'Foundations', level: F },
  { slug: 'calculus-2', title: 'Calculus 2', branch: 'Foundations', level: F },
  { slug: 'calculus-3', title: 'Calculus 3', branch: 'Foundations', level: F },
  { slug: 'linear-algebra', title: 'Linear Algebra', branch: 'Foundations', level: F },
  { slug: 'differential-equations', title: 'Differential Equations', branch: 'Foundations', level: F },
  { slug: 'intro-proofs', title: 'Introduction to Proofs', branch: 'Foundations', level: F },
  { slug: 'discrete-mathematics', title: 'Discrete Mathematics', branch: 'Foundations', level: F },
  { slug: 'probability', title: 'Probability', branch: 'Foundations', level: F },
  { slug: 'statistics', title: 'Statistics', branch: 'Foundations', level: F },

  // Analysis
  { slug: 'real-analysis', title: 'Real Analysis', branch: 'Analysis', level: C },
  { slug: 'complex-analysis', title: 'Complex Analysis', branch: 'Analysis', level: C },
  { slug: 'measure-theory', title: 'Measure Theory', branch: 'Analysis', level: A },
  { slug: 'functional-analysis', title: 'Functional Analysis', branch: 'Analysis', level: A },
  { slug: 'fourier-analysis', title: 'Fourier Analysis', branch: 'Analysis', level: A },
  { slug: 'harmonic-analysis', title: 'Harmonic Analysis', branch: 'Analysis', level: A },

  // Algebra
  { slug: 'abstract-algebra', title: 'Abstract Algebra', branch: 'Algebra', level: C },
  { slug: 'group-theory', title: 'Group Theory', branch: 'Algebra', level: C },
  { slug: 'ring-theory', title: 'Ring Theory', branch: 'Algebra', level: C },
  { slug: 'field-theory', title: 'Field Theory', branch: 'Algebra', level: A },
  { slug: 'galois-theory', title: 'Galois Theory', branch: 'Algebra', level: A },
  { slug: 'commutative-algebra', title: 'Commutative Algebra', branch: 'Algebra', level: A },
  { slug: 'category-theory', title: 'Category Theory', branch: 'Algebra', level: A },
  { slug: 'representation-theory', title: 'Representation Theory', branch: 'Algebra', level: A },
  { slug: 'lie-groups', title: 'Lie Groups', branch: 'Algebra', level: A },
  { slug: 'lie-algebras', title: 'Lie Algebras', branch: 'Algebra', level: A },

  // Number Theory
  { slug: 'algebraic-number-theory', title: 'Algebraic Number Theory', branch: 'Number Theory', level: A },
  { slug: 'analytic-number-theory', title: 'Analytic Number Theory', branch: 'Number Theory', level: T, isTarget: true, description: 'Target field: L-functions, prime distribution, sieve methods.' },
  { slug: 'geometric-number-theory', title: 'Geometric Number Theory', branch: 'Number Theory', level: A },
  { slug: 'iwasawa-theory', title: 'Iwasawa Theory', branch: 'Number Theory', level: T, isTarget: true, description: 'Target field: Z_p-extensions, class groups, p-adic L-functions.' },

  // Topology & Geometry
  { slug: 'point-set-topology', title: 'Point-Set Topology', branch: 'Topology & Geometry', level: C },
  { slug: 'algebraic-topology', title: 'Algebraic Topology', branch: 'Topology & Geometry', level: A },
  { slug: 'differential-geometry', title: 'Differential Geometry', branch: 'Topology & Geometry', level: A },
  { slug: 'riemannian-geometry', title: 'Riemannian Geometry', branch: 'Topology & Geometry', level: A },
  { slug: 'symplectic-geometry', title: 'Symplectic Geometry', branch: 'Topology & Geometry', level: A },

  // Differential Equations & Dynamics
  { slug: 'ode', title: 'Ordinary Differential Equations', branch: 'DE & Dynamics', level: C },
  { slug: 'pde', title: 'Partial Differential Equations', branch: 'DE & Dynamics', level: A },
  { slug: 'dynamical-systems', title: 'Dynamical Systems', branch: 'DE & Dynamics', level: A },
  { slug: 'ergodic-theory', title: 'Ergodic Theory', branch: 'DE & Dynamics', level: A },

  // Probability & Statistics
  { slug: 'probability-theory', title: 'Probability Theory', branch: 'Probability & Statistics', level: A, description: 'Measure-theoretic probability.' },
  { slug: 'stochastic-processes', title: 'Stochastic Processes', branch: 'Probability & Statistics', level: A },
  { slug: 'mathematical-statistics', title: 'Mathematical Statistics', branch: 'Probability & Statistics', level: A },

  // Applied
  { slug: 'optimization-theory', title: 'Optimization Theory', branch: 'Applied', level: C },
  { slug: 'game-theory', title: 'Game Theory', branch: 'Applied', level: C },
  { slug: 'voting-theory', title: 'Voting Theory', branch: 'Applied', level: A },
  { slug: 'numerical-analysis', title: 'Numerical Analysis', branch: 'Applied', level: C },
  { slug: 'cryptography', title: 'Cryptography', branch: 'Applied', level: A },
  { slug: 'coding-theory', title: 'Coding Theory', branch: 'Applied', level: A },

  // Targets (beyond Iwasawa, which sits in Number Theory)
  { slug: 'quantum-field-theory', title: 'Quantum Field Theory', branch: 'Targets', level: T, isTarget: true, description: 'Target field: QFT for mathematicians/physicists.' },
  { slug: 'physics-phenomenology', title: 'Physics Phenomenology', branch: 'Targets', level: T, isTarget: true, description: 'Target field: particle phenomenology, model building, collider observables.' },
  { slug: 'quantitative-finance', title: 'Quantitative Finance', branch: 'Targets', level: T, isTarget: true, description: 'Target field: derivatives pricing, stochastic calculus, risk.' },
];

const P = (from: string, to: string): SeedEdge => ({ from, to, kind: 'PREREQUISITE' });
const APP = (from: string, to: string): SeedEdge => ({ from, to, kind: 'APPLICATION' });

export const MATH_EDGES: SeedEdge[] = [
  // Foundation chain
  P('algebra-1', 'algebra-2'),
  P('algebra-2', 'precalculus'),
  P('geometry', 'trigonometry'),
  P('trigonometry', 'precalculus'),
  P('precalculus', 'calculus-1'),
  P('calculus-1', 'calculus-2'),
  P('calculus-2', 'calculus-3'),
  P('algebra-2', 'linear-algebra'),
  P('calculus-2', 'linear-algebra'),
  P('calculus-2', 'differential-equations'),
  P('linear-algebra', 'differential-equations'),
  P('algebra-2', 'intro-proofs'),
  P('intro-proofs', 'discrete-mathematics'),
  P('calculus-2', 'probability'),
  P('probability', 'statistics'),

  // Analysis
  P('calculus-3', 'real-analysis'),
  P('intro-proofs', 'real-analysis'),
  P('real-analysis', 'complex-analysis'),
  P('real-analysis', 'measure-theory'),
  P('measure-theory', 'functional-analysis'),
  P('linear-algebra', 'functional-analysis'),
  P('real-analysis', 'fourier-analysis'),
  P('fourier-analysis', 'harmonic-analysis'),
  P('measure-theory', 'harmonic-analysis'),

  // Algebra
  P('intro-proofs', 'abstract-algebra'),
  P('linear-algebra', 'abstract-algebra'),
  P('abstract-algebra', 'group-theory'),
  P('abstract-algebra', 'ring-theory'),
  P('ring-theory', 'field-theory'),
  P('field-theory', 'galois-theory'),
  P('group-theory', 'galois-theory'),
  P('ring-theory', 'commutative-algebra'),
  P('abstract-algebra', 'category-theory'),
  P('group-theory', 'representation-theory'),
  P('linear-algebra', 'representation-theory'),
  P('group-theory', 'lie-groups'),
  P('differential-geometry', 'lie-groups'),
  P('linear-algebra', 'lie-algebras'),
  P('group-theory', 'lie-algebras'),

  // Number theory
  P('galois-theory', 'algebraic-number-theory'),
  P('commutative-algebra', 'algebraic-number-theory'),
  P('complex-analysis', 'analytic-number-theory'),
  P('algebraic-number-theory', 'geometric-number-theory'),
  P('linear-algebra', 'geometric-number-theory'),

  // Iwasawa Theory target path (as specified)
  P('intro-proofs', 'iwasawa-theory'),
  P('abstract-algebra', 'iwasawa-theory'),
  P('group-theory', 'iwasawa-theory'),
  P('ring-theory', 'iwasawa-theory'),
  P('field-theory', 'iwasawa-theory'),
  P('galois-theory', 'iwasawa-theory'),
  P('commutative-algebra', 'iwasawa-theory'),
  P('algebraic-number-theory', 'iwasawa-theory'),

  // Topology & geometry
  P('intro-proofs', 'point-set-topology'),
  P('real-analysis', 'point-set-topology'),
  P('point-set-topology', 'algebraic-topology'),
  P('abstract-algebra', 'algebraic-topology'),
  P('calculus-3', 'differential-geometry'),
  P('linear-algebra', 'differential-geometry'),
  P('point-set-topology', 'differential-geometry'),
  P('differential-geometry', 'riemannian-geometry'),
  P('differential-geometry', 'symplectic-geometry'),

  // DE & dynamics
  P('differential-equations', 'ode'),
  P('real-analysis', 'ode'),
  P('ode', 'pde'),
  P('calculus-3', 'pde'),
  P('ode', 'dynamical-systems'),
  P('measure-theory', 'ergodic-theory'),
  P('dynamical-systems', 'ergodic-theory'),

  // Probability & statistics
  P('probability', 'probability-theory'),
  P('measure-theory', 'probability-theory'),
  P('probability-theory', 'stochastic-processes'),
  P('probability-theory', 'mathematical-statistics'),
  P('statistics', 'mathematical-statistics'),

  // Applied
  P('linear-algebra', 'optimization-theory'),
  P('calculus-3', 'optimization-theory'),
  P('probability', 'game-theory'),
  P('optimization-theory', 'game-theory'),
  P('discrete-mathematics', 'voting-theory'),
  P('game-theory', 'voting-theory'),
  P('linear-algebra', 'numerical-analysis'),
  P('calculus-2', 'numerical-analysis'),
  P('abstract-algebra', 'cryptography'),
  P('discrete-mathematics', 'cryptography'),
  P('linear-algebra', 'coding-theory'),
  P('abstract-algebra', 'coding-theory'),

  // Quantum Field Theory target path (as specified)
  P('calculus-3', 'quantum-field-theory'),
  P('linear-algebra', 'quantum-field-theory'),
  P('differential-equations', 'quantum-field-theory'),
  P('pde', 'quantum-field-theory'),
  P('complex-analysis', 'quantum-field-theory'),
  P('fourier-analysis', 'quantum-field-theory'),
  P('functional-analysis', 'quantum-field-theory'),
  P('lie-groups', 'quantum-field-theory'),
  P('lie-algebras', 'quantum-field-theory'),
  P('representation-theory', 'quantum-field-theory'),
  P('differential-geometry', 'quantum-field-theory'),

  // Physics Phenomenology target path (as specified)
  P('calculus-3', 'physics-phenomenology'),
  P('linear-algebra', 'physics-phenomenology'),
  P('differential-equations', 'physics-phenomenology'),
  P('pde', 'physics-phenomenology'),
  P('probability', 'physics-phenomenology'),
  P('statistics', 'physics-phenomenology'),
  P('numerical-analysis', 'physics-phenomenology'),
  P('lie-groups', 'physics-phenomenology'),
  P('lie-algebras', 'physics-phenomenology'),
  P('representation-theory', 'physics-phenomenology'),
  P('quantum-field-theory', 'physics-phenomenology'),

  // Quantitative Finance target path (as specified)
  P('calculus-1', 'quantitative-finance'),
  P('calculus-2', 'quantitative-finance'),
  P('linear-algebra', 'quantitative-finance'),
  P('probability', 'quantitative-finance'),
  P('statistics', 'quantitative-finance'),
  P('stochastic-processes', 'quantitative-finance'),
  P('optimization-theory', 'quantitative-finance'),
  P('numerical-analysis', 'quantitative-finance'),
  P('differential-equations', 'quantitative-finance'),

  // Dotted application / relevance edges
  APP('galois-theory', 'cryptography'),
  APP('analytic-number-theory', 'cryptography'),
  APP('ergodic-theory', 'analytic-number-theory'),
  APP('category-theory', 'algebraic-topology'),
  APP('category-theory', 'representation-theory'),
  APP('coding-theory', 'cryptography'),
  APP('harmonic-analysis', 'analytic-number-theory'),
  APP('representation-theory', 'harmonic-analysis'),
  APP('symplectic-geometry', 'quantum-field-theory'),
  APP('algebraic-topology', 'quantum-field-theory'),
  APP('pde', 'quantitative-finance'),
  APP('measure-theory', 'quantitative-finance'),
  APP('game-theory', 'quantitative-finance'),
];
