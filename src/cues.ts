// Technique cues per main lift, shown from the "?" next to each lift on Today.
import type { Lift } from './engine.ts';

export interface LiftCues {
  setup: string[];
  execute: string[];
  watch: string[];
}

export const CUES: Record<Lift, LiftCues> = {
  squat: {
    setup: [
      'Bar on the shelf of your traps or rear delts, hands as close as shoulders allow.',
      'Elbows pulled under the bar, upper back tight.',
      'Unrack, two or three short steps back, feet about shoulder width and toes slightly out.',
    ],
    execute: [
      'Big breath into the belly, brace like taking a punch.',
      'Sit down between your legs, knees tracking over the toes.',
      'Hip crease below the knee, then drive the whole foot through the floor.',
      'Hips and chest rise together; do not let the hips shoot up first.',
    ],
    watch: [
      'Knees caving in on the way up.',
      'Losing the brace at the bottom.',
      'Cutting depth as the weight goes up.',
    ],
  },
  bench: {
    setup: [
      'Feet flat and planted, shoulder blades pinched together and pulled down.',
      'Slight arch, eyes under the bar, grip so forearms are vertical at the bottom.',
      'Unrack to over the shoulders, not the chest.',
    ],
    execute: [
      'Pull the bar down to the lower chest, elbows around 45 degrees, not flared.',
      'Touch, pause a beat, then drive the feet into the floor.',
      'Press back toward the face and lock out over the shoulders.',
    ],
    watch: [
      'Shoulders rising off the bench on the press.',
      'Butt leaving the bench.',
      'Bouncing the bar off the chest.',
    ],
  },
  deadlift: {
    setup: [
      'Bar over mid-foot, about an inch from the shins, feet hip width.',
      'Hinge to grip just outside the legs, then bring the shins to the bar.',
      'Chest up, lats tight: squeeze oranges in your armpits.',
    ],
    execute: [
      'Pull the slack out of the bar until you hear it click, then push the floor away.',
      'Keep the bar dragging up the legs.',
      'Hips and shoulders rise at the same rate.',
      'Finish tall with the glutes, no lean back.',
    ],
    watch: [
      'Hips shooting up and turning it into a stiff-leg pull.',
      'Rounding the lower back off the floor.',
      'Bar drifting away from the shins.',
    ],
  },
  press: {
    setup: [
      'Grip just outside the shoulders, forearms vertical, bar resting on the upper chest.',
      'Feet hip width, glutes and abs squeezed hard.',
      'Chin back so the bar has a straight path.',
    ],
    execute: [
      'Press in a straight line; move the head back, not the bar forward.',
      'Once the bar passes the forehead, push the head through.',
      'Lock out with the bar over the mid-foot and shrug up at the top.',
    ],
    watch: [
      'Leaning back and turning it into an incline press.',
      'Bar looping forward around the face.',
      'Elbows dropping behind the bar at the bottom.',
    ],
  },
};
