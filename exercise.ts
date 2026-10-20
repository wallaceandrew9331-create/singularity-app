/**
 * Singularity — exercise library schema.
 *
 * Two entities, deliberately separate:
 *
 *   Exercise            the movement itself. A library entity. Carries no prescription.
 *   PrescribedExercise  one slot in one workout. References an Exercise by id and
 *                       carries the sets/reps/rest for THAT slot.
 *
 * The 2019 schema merged them, which is why every goblet squat in the database was
 * 4x12/60s forever, and why workouts stored exercise names as free strings that
 * matched nothing in the library.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Taxonomy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The primary substitution axis. A swap preserves the pattern; it may change
 * everything else.
 *
 * `flexion` and `anti_extension` were added while seeding the library — the
 * original eleven patterns had nowhere to put v-ups, leg raises or planks.
 */
export type MovementPattern =
  | 'squat'              // knee-dominant, bilateral
  | 'hinge'              // hip-dominant
  | 'lunge'              // split stance / single leg
  | 'horizontal_push'
  | 'vertical_push'
  | 'horizontal_pull'
  | 'vertical_pull'
  | 'carry'
  | 'rotation'           // trunk produces rotation
  | 'anti_rotation'      // trunk resists rotation
  | 'anti_extension'     // trunk resists extension
  | 'flexion'            // trunk produces flexion
  | 'gait';              // walk / run / sprint / sled

export type Joint =
  | 'knee' | 'back' | 'shoulder' | 'hip' | 'elbow' | 'wrist' | 'ankle';

/**
 * How a movement earns its place in a session.
 *
 * Added while seeding: without it, a lying hamstring curl and a Romanian deadlift
 * are both `hinge` and the substitution engine will happily trade one for the
 * other. Role is a hard filter — primaries only ever swap for primaries.
 */
export type ExerciseRole =
  | 'primary'     // the session is built around it
  | 'accessory'   // supports a primary, multi-joint
  | 'isolation';  // single joint

/**
 * How the movement is counted. Added while seeding: `viable_reps` is meaningless
 * for treadmill intervals.
 */
export type PrescriptionUnit = 'reps' | 'time' | 'distance';

/**
 * Joint loading, 0–3. Read against the intake form's none/mild/severe answers:
 *
 *   user reports severe →  exclude exercises with stress >= 2
 *   user reports mild   →  exclude exercises with stress >= 3
 *
 *   0  no meaningful load on that joint
 *   1  normal loading, fine for a healthy joint
 *   2  significant loading — the joint is a limiting factor
 *   3  high loading — avoid on any history of pain
 */
export type JointStress = 0 | 1 | 2 | 3;

/**
 * Compound lifts are more than one pattern. This is what makes decomposition
 * possible: to replace a movement with two others, you need to know which
 * parts you are covering.
 *
 * `emphasis` sums to 1.0 across components. It doubles as the weighting for
 * weekly volume-per-pattern accounting.
 */
export interface MovementComponent {
  pattern: MovementPattern;
  emphasis: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exercise
// ─────────────────────────────────────────────────────────────────────────────

export interface Exercise {
  /** Stable slug. Never a display name — that is what broke the 2019 data. */
  id: string;
  name: string;
  /** Every other way this lift gets written down. Catches the duplicate problem. */
  aliases: string[];

  // What it IS — drives substitution
  components: MovementComponent[];
  role: ExerciseRole;
  unilateral: boolean;
  velocity: 'grind' | 'ballistic';

  // What it NEEDS — hard filters
  equipment: string[];
  skill_demand: 1 | 2 | 3 | 4 | 5;
  joint_stress: Partial<Record<Joint, JointStress>>;

  // What it TRAINS — ranking, and weekly volume accounting
  primary_muscles: string[];
  secondary_muscles: string[];

  // How it should be PRESCRIBED
  prescription_unit: PrescriptionUnit;
  /** Rep range the movement actually works in. null when unit is not 'reps'. */
  viable_reps: [number, number] | null;
  viable_duration_sec?: [number, number];
  default_rest_sec: number;

  // Coaching
  /** Mechanical setup. Factual. */
  setup: string;
  /** The one thing you say to fix it. Left empty in the seed — your voice, not mine. */
  cue: string;
  tags: string[];

  /**
   * Hand-authored substitutions. Optional, and they outrank the computed path.
   *
   * Computed substitution handles the long tail. It produces mediocre answers for
   * olympic lifts and anything where the decomposition is non-obvious, so the
   * twenty lifts that matter get authored by hand.
   */
  substitutions?: {
    lateral?: string[];
    regress?: string[];
    progress?: string[];
    /** Each inner array is a set of exercises that together cover this movement. */
    decompose?: string[][];
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Prescription
// ─────────────────────────────────────────────────────────────────────────────

export interface PrescribedExercise {
  exercise_id: string;
  order: number;
  sets: number;
  reps?: number | [number, number];
  duration_sec?: number;
  rest_sec: number;
  target_rpe?: number;
  /** exercise_id. How a decomposition lands in a program. */
  superset_with?: string;
  /** "Substituted for Power Clean — power quality reduced." */
  note?: string;
}

export interface Workout {
  id: string;
  name: string;
  focus: string;
  /** Maps to training frequency: a 3-day week takes priority 1–3. */
  priority: number;
  exercises: PrescribedExercise[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Substitution
// ─────────────────────────────────────────────────────────────────────────────

export type SubstitutionIntent = 'lateral' | 'regress' | 'progress' | 'decompose';

export interface UserConstraints {
  /** Ceiling derived from the intake's resistance-training experience answer. */
  skill_ceiling: 1 | 2 | 3 | 4 | 5;
  /** From the intake's knee / back / shoulder questions. */
  pain: Partial<Record<Joint, 'none' | 'mild' | 'severe'>>;
  /** Exercises the user has opted out of. */
  excluded: string[];
}

export interface GymConstraints {
  available_equipment: string[];
  /** Movements the facility does not permit — e.g. olympic lifts. */
  banned_tags: string[];
}

export interface SubstitutionResult {
  /** One id, or two when the result is a decomposition. */
  exercise_ids: string[];
  intent: SubstitutionIntent;
  score: number;
  /** Prescription rewritten to suit the replacement. */
  prescription: Omit<PrescribedExercise, 'exercise_id' | 'order'>;
  /** What the swap gives up. Shown to the user. */
  tradeoff?: string;
}
